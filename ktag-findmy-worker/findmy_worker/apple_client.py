"""
Fala com a rede Find My via FindMy.py, saindo pelo proxy residencial.

A Apple bloqueia consulta de Find My vinda de datacenter — DigitalOcean
incluída. Sem proxy, o login retorna 200 OK e a busca devolve lista vazia, o
que é indistinguível de "ninguém viu a TAG". Por isso o worker se recusa a
consultar sem proxy configurado.
"""
import importlib
import inspect
import os
from datetime import timedelta
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
            conta = AppleAccount(self._anisette)
            conta.restore(arquivo.read_text(encoding="utf-8"))
            self._conta = conta
        return self._conta

    def buscar(self, tags: list, backfill_horas: int) -> list:
        if self._sessao_morta:
            raise ErroDeAutenticacaoApple(
                "sessão da Apple já foi marcada como inválida nesta execução — "
                "não consulto de novo até o processo ser reiniciado com sessão nova"
            )

        conta = self._sessao()
        chaves = [KeyPair.from_b64(t["privateKey"]) for t in tags]
        janela = timedelta(hours=backfill_horas or 1)

        try:
            relatorios = conta.fetch_last_reports(chaves, hours=int(janela.total_seconds() // 3600))
        except UnauthorizedError as erro:
            self._sessao_morta = True
            raise ErroDeAutenticacaoApple(
                "Apple recusou a sessão (expirada ou revogada). É preciso login "
                "manual novo com --trusteddevice — o worker não reautentica "
                "sozinho porque o 2FA por SMS da Apple está quebrado."
            ) from erro

        return [
            {
                "latitude": r.latitude,
                "longitude": r.longitude,
                "horizontal_accuracy": getattr(r, "horizontal_accuracy", None),
                "timestamp": r.timestamp,
                "hashed_adv_key": r.hashed_adv_key_b64,
            }
            for r in relatorios
        ]
