"""
Fala com a rede Find My via FindMy.py, saindo pelo proxy residencial.

Adaptador escrito e conferido linha a linha contra o wheel de findmy==0.10.1
(baixado com `pip download --no-deps` e inspecionado sem instalar — a lib
nunca entra no ambiente, ver requirements.txt / README). Se o pin desta lib
mudar, reconferir aqui antes de mais nada: `AppleAccount.__init__`/`state_info`,
`fetch_location_history` (não tem `restore()` nem parâmetro de janela de
tempo nesta versão) e os atributos de `LocationReport`.

A Apple bloqueia consulta de Find My vinda de datacenter — DigitalOcean
incluída. Sem proxy, o login retorna 200 OK e a busca devolve lista vazia, o
que é indistinguível de "ninguém viu a TAG". Por isso o worker se recusa a
consultar sem proxy configurado.
"""
import importlib
import inspect
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from findmy import KeyPair
from findmy.errors import UnauthorizedError
from findmy.reports import RemoteAnisetteProvider, AppleAccount

from .apple_errors import ErroDeAutenticacaoApple


def _instalar_proxy_no_findmy(proxy: str) -> None:
    """
    FindMy.py não expõe nenhuma forma pública de configurar proxy. A sessão
    aiohttp é criada internamente em `findmy.util.http.HttpSession._get_session`
    com `ClientSession(timeout=...)`, sem `trust_env` — e o default do aiohttp
    é `trust_env=False`, então `HTTP_PROXY`/`HTTPS_PROXY` no ambiente são
    ignorados. Sem isso a consulta sai pelo IP do droplet e a Apple devolve
    lista vazia sem erro nenhum (ver docstring do módulo). Por isso o
    monkeypatch: é o único jeito de forçar o proxy a ser usado de fato.
    """
    try:
        modulo_http = importlib.import_module("findmy.util.http")
    except ImportError as erro:
        raise RuntimeError(
            "FindMy.py mudou de estrutura e o módulo findmy.util.http não "
            "existe mais. O proxy não pôde ser instalado — consultar a Apple "
            "agora sairia direto pelo IP do droplet e devolveria lista vazia "
            "silenciosamente. Corrigir este monkeypatch antes de continuar."
        ) from erro

    if not hasattr(modulo_http, "HttpSession") or not hasattr(modulo_http.HttpSession, "_get_session"):
        raise RuntimeError(
            "FindMy.py mudou de versão e findmy.util.http.HttpSession não "
            "tem mais _get_session. O proxy não pôde ser instalado — "
            "consultar a Apple agora sairia direto pelo IP do droplet e "
            "devolveria lista vazia silenciosamente. Corrigir este "
            "monkeypatch antes de continuar."
        )

    # Env vars só depois do guard acima: se a estrutura da lib mudou, é
    # melhor abortar sem deixar nada meio-configurado do que seguir cru.
    os.environ["HTTPS_PROXY"] = proxy
    os.environ["HTTP_PROXY"] = proxy

    metodo_original = modulo_http.HttpSession._get_session
    if getattr(metodo_original, "_ktag_proxy_instalado", False):
        return  # já patcheado — idempotente, não empilha wrapper em cima de wrapper

    if inspect.iscoroutinefunction(metodo_original):
        async def _get_session_com_proxy(self):
            sessao = await metodo_original(self)
            sessao._trust_env = True
            return sessao
    else:
        def _get_session_com_proxy(self):
            sessao = metodo_original(self)
            sessao._trust_env = True
            return sessao

    _get_session_com_proxy._ktag_proxy_instalado = True
    modulo_http.HttpSession._get_session = _get_session_com_proxy


class AppleClient:
    def __init__(self, pasta_sessao: Path, anisette_url: str, proxy: str):
        if not proxy:
            raise ValueError(
                "Proxy residencial não configurado. Consultar a Apple pelo IP "
                "do droplet devolve lista vazia silenciosamente."
            )
        _instalar_proxy_no_findmy(proxy)
        self._pasta_sessao = Path(pasta_sessao)
        self._anisette = RemoteAnisetteProvider(anisette_url)
        self._proxy = proxy
        self._conta = None
        # Uma vez que a Apple recusa a sessão, não adianta tentar de novo no
        # próximo ciclo: reautenticação automática está desligada de
        # propósito (2FA por SMS quebrado). Fica marcado até o processo ser
        # reiniciado com uma sessão nova via login manual.
        self._sessao_morta = False

    def _sessao(self) -> AppleAccount:
        if self._conta is None:
            arquivo = self._pasta_sessao / "account.json"
            if not arquivo.exists():
                raise RuntimeError(
                    "Sessão da Apple ausente. Rodar o login interativo uma vez "
                    "com --trusteddevice (o código chega no iPhone)."
                )
            # Na 0.10.1 AppleAccount não tem mais `.restore()`. O estado
            # salvo (formato AccountStateMapping: ids/account/login/anisette)
            # entra pelo próprio construtor via `state_info=`. Não usamos
            # `AppleAccount.from_json`, que reconstruiria o AnisetteProvider
            # a partir do que ficou gravado dentro do account.json — aqui
            # queremos que o `ANISETTE_URL` configurado no worker, já
            # instanciado em `self._anisette`, seja sempre a fonte da
            # verdade (se o servidor Anisette mudar de endereço, um
            # account.json antigo não deve reintroduzir o endereço velho).
            estado = json.loads(arquivo.read_text(encoding="utf-8"))
            self._conta = AppleAccount(self._anisette, state_info=estado)
        return self._conta

    def buscar(self, tags: list, backfill_horas: int) -> list:
        if self._sessao_morta:
            raise ErroDeAutenticacaoApple(
                "sessão da Apple já foi marcada como inválida nesta execução — "
                "não consulto de novo até o processo ser reiniciado com sessão nova"
            )

        conta = self._sessao()
        chaves = [KeyPair.from_b64(t["privateKey"]) for t in tags]

        try:
            relatorios_por_chave = conta.fetch_location_history(chaves)
        except UnauthorizedError as erro:
            self._sessao_morta = True
            raise ErroDeAutenticacaoApple(
                "Apple recusou a sessão (expirada ou revogada). É preciso login "
                "manual novo com --trusteddevice — o worker não reautentica "
                "sozinho porque o 2FA por SMS da Apple está quebrado."
            ) from erro

        # `fetch_location_history` na 0.10.1 não aceita janela de tempo — não
        # existe mais o `hours=` que este adaptador assumia. Por baixo, a
        # Apple é sempre consultada com os últimos 7 dias fixos
        # (findmy/reports/account.py, fetch_raw_reports, start_ts = now - 7d,
        # não parametrizável). O corte por `backfill_horas` que o backend
        # pede — pra não continuar puxando a semana inteira a cada ciclo
        # enquanto a TAG seguir em modo acelerado (ver backfill.py) — é
        # aplicado aqui, localmente, sobre o que a Apple devolveu.
        corte = datetime.now(timezone.utc) - timedelta(hours=backfill_horas or 1)

        return [
            {
                "latitude": relatorio.latitude,
                "longitude": relatorio.longitude,
                "horizontal_accuracy": getattr(relatorio, "horizontal_accuracy", None),
                "timestamp": relatorio.timestamp,
                "hashed_adv_key": relatorio.hashed_adv_key_b64,
            }
            for relatorios in relatorios_por_chave.values()
            for relatorio in relatorios
            if relatorio.timestamp >= corte
        ]
