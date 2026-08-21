"""
Testa o monkeypatch que instala o proxy dentro do FindMy.py
(findmy_worker.apple_client._instalar_proxy_no_findmy) e o adaptador
AppleClient.buscar, sem depender da lib `findmy` de verdade — ela não está
instalada neste ambiente e não pode ser.

Em vez disso, injetamos em sys.modules um `findmy` de mentira com a mesma
forma verificada contra o wheel de findmy==0.10.1 (findmy.KeyPair.from_b64,
findmy.errors.UnauthorizedError, findmy.reports.RemoteAnisetteProvider,
findmy.reports.AppleAccount(anisette, state_info=...).fetch_location_history,
findmy.util.http.HttpSession._get_session) só o suficiente pra importar
apple_client.py e exercitar o instalador do proxy e o `buscar`.
"""
import asyncio
import importlib
import inspect
import json
import os
import sys
import types
from datetime import datetime, timedelta, timezone

import pytest

PROXY = "http://usuario:senha@proxy-residencial:8080"


def _stub_findmy_base():
    """Stub mínimo pro `from findmy import KeyPair` / `from findmy.errors
    import ...` / `from findmy.reports import ...` que apple_client.py faz no
    topo do arquivo. Não é o alvo do teste — só existe pra permitir importar
    o módulo sem a lib real."""
    findmy = types.ModuleType("findmy")
    findmy.KeyPair = object
    findmy_errors = types.ModuleType("findmy.errors")

    class UnauthorizedErrorStub(Exception):
        pass

    findmy_errors.UnauthorizedError = UnauthorizedErrorStub
    findmy_reports = types.ModuleType("findmy.reports")
    findmy_reports.RemoteAnisetteProvider = object
    findmy_reports.AppleAccount = object
    findmy_util = types.ModuleType("findmy.util")

    sys.modules["findmy"] = findmy
    sys.modules["findmy.errors"] = findmy_errors
    sys.modules["findmy.reports"] = findmy_reports
    sys.modules["findmy.util"] = findmy_util


def _stub_http_session(com_get_session=True, com_http_session=True):
    """Constrói o stub de findmy.util.http. Por padrão espelha a estrutura
    real (HttpSession com _get_session); com com_get_session=False ou
    com_http_session=False, simula uma versão da lib que mudou de forma."""
    modulo = types.ModuleType("findmy.util.http")

    if com_http_session:
        class HttpSessionStub:
            def _get_session(self):
                return types.SimpleNamespace(_trust_env=False)

        if not com_get_session:
            del HttpSessionStub._get_session

        modulo.HttpSession = HttpSessionStub

    sys.modules["findmy.util.http"] = modulo
    return modulo


def _stub_http_session_async():
    """Variante em que _get_session é uma coroutine — o caminho plausível de
    verdade da lib real (aiohttp cria sessão dentro de um loop). O teste
    original só cobria a versão síncrona do stub; se a lib real usa
    `async def _get_session`, o ramo `inspect.iscoroutinefunction` do
    monkeypatch nunca era exercitado."""
    modulo = types.ModuleType("findmy.util.http")

    class HttpSessionStub:
        async def _get_session(self):
            return types.SimpleNamespace(_trust_env=False)

    modulo.HttpSession = HttpSessionStub
    sys.modules["findmy.util.http"] = modulo
    return modulo


@pytest.fixture(autouse=True)
def isolar_findmy_e_env():
    """Garante que nenhum teste vaza stub de findmy.* nem HTTP(S)_PROXY para
    o próximo. findmy_worker.apple_client em si pode continuar importado
    entre testes (não referencia sys.modules["findmy.util.http"] direto —
    ele resolve via importlib.import_module a cada chamada), então não
    precisa ser removido."""
    proxy_env_originais = {chave: os.environ.get(chave) for chave in ("HTTP_PROXY", "HTTPS_PROXY")}

    yield

    for chave in list(sys.modules):
        if chave == "findmy" or chave.startswith("findmy."):
            del sys.modules[chave]

    for chave, valor in proxy_env_originais.items():
        if valor is None:
            os.environ.pop(chave, None)
        else:
            os.environ[chave] = valor


def _importar_instalador():
    from findmy_worker import apple_client
    return apple_client._instalar_proxy_no_findmy


def test_instala_proxy_configura_variaveis_de_ambiente():
    _stub_findmy_base()
    _stub_http_session()
    instalar = _importar_instalador()

    instalar(PROXY)

    assert os.environ["HTTPS_PROXY"] == PROXY
    assert os.environ["HTTP_PROXY"] == PROXY


def test_instala_proxy_substitui_get_session():
    _stub_findmy_base()
    modulo_http = _stub_http_session()
    metodo_original = modulo_http.HttpSession._get_session
    instalar = _importar_instalador()

    instalar(PROXY)

    assert modulo_http.HttpSession._get_session is not metodo_original


def test_instalar_duas_vezes_nao_empilha_wrapper():
    _stub_findmy_base()
    modulo_http = _stub_http_session()
    instalar = _importar_instalador()

    instalar(PROXY)
    metodo_depois_da_primeira = modulo_http.HttpSession._get_session

    instalar(PROXY)
    metodo_depois_da_segunda = modulo_http.HttpSession._get_session

    assert metodo_depois_da_primeira is metodo_depois_da_segunda


def test_sessao_construida_pelo_metodo_patcheado_fica_com_trust_env():
    _stub_findmy_base()
    modulo_http = _stub_http_session()
    instalar = _importar_instalador()

    instalar(PROXY)

    sessao = modulo_http.HttpSession()._get_session()
    assert sessao._trust_env is True


def test_sem_httpsession_recusa_e_nao_deixa_env_pela_metade():
    _stub_findmy_base()
    _stub_http_session(com_http_session=False)
    instalar = _importar_instalador()

    with pytest.raises(RuntimeError):
        instalar(PROXY)

    assert "HTTPS_PROXY" not in os.environ
    assert "HTTP_PROXY" not in os.environ


def test_sem_get_session_recusa_e_nao_deixa_env_pela_metade():
    _stub_findmy_base()
    _stub_http_session(com_get_session=False)
    instalar = _importar_instalador()

    with pytest.raises(RuntimeError):
        instalar(PROXY)

    assert "HTTPS_PROXY" not in os.environ
    assert "HTTP_PROXY" not in os.environ


def test_instala_proxy_substitui_get_session_assincrono():
    _stub_findmy_base()
    modulo_http = _stub_http_session_async()
    metodo_original = modulo_http.HttpSession._get_session
    instalar = _importar_instalador()

    instalar(PROXY)

    assert modulo_http.HttpSession._get_session is not metodo_original
    assert inspect.iscoroutinefunction(modulo_http.HttpSession._get_session)


def test_sessao_construida_pelo_metodo_patcheado_assincrono_fica_com_trust_env():
    _stub_findmy_base()
    modulo_http = _stub_http_session_async()
    instalar = _importar_instalador()

    instalar(PROXY)

    sessao = asyncio.run(modulo_http.HttpSession()._get_session())
    assert sessao._trust_env is True


def test_instalar_duas_vezes_assincrono_nao_empilha_wrapper():
    _stub_findmy_base()
    modulo_http = _stub_http_session_async()
    instalar = _importar_instalador()

    instalar(PROXY)
    metodo_depois_da_primeira = modulo_http.HttpSession._get_session

    instalar(PROXY)
    metodo_depois_da_segunda = modulo_http.HttpSession._get_session

    assert metodo_depois_da_primeira is metodo_depois_da_segunda


# --- AppleClient.buscar, contra a forma real de findmy==0.10.1 -------------
#
# `apple_client.py` resolve `KeyPair`, `UnauthorizedError`, `AppleAccount` e
# `RemoteAnisetteProvider` uma única vez, no topo do módulo, com
# `from findmy... import ...`. Se `findmy_worker.apple_client` continuar em
# sys.modules de um teste anterior (o que o restante deste arquivo faz de
# propósito, ver docstring de `isolar_findmy_e_env`), essas referências
# ficam presas ao stub do primeiro teste que importou o módulo. Por isso os
# testes de `buscar` sempre reimportam apple_client do zero, depois de
# registrar o stub que querem exercitar.


class _RelatorioStub:
    """Espelha os atributos reais de findmy.reports.reports.LocationReport
    que apple_client.py lê: latitude, longitude, horizontal_accuracy,
    timestamp e hashed_adv_key_b64 (conferido no wheel de 0.10.1)."""

    def __init__(self, latitude, longitude, horizontal_accuracy, timestamp, hashed_adv_key_b64):
        self.latitude = latitude
        self.longitude = longitude
        self.horizontal_accuracy = horizontal_accuracy
        self.timestamp = timestamp
        self.hashed_adv_key_b64 = hashed_adv_key_b64


def _stub_findmy_para_buscar(respostas=None, levanta_unauthorized=False):
    """Registra em sys.modules um `findmy` com a forma real de 0.10.1 usada
    por AppleClient.buscar: KeyPair.from_b64, findmy.errors.UnauthorizedError,
    RemoteAnisetteProvider(url), AppleAccount(anisette, state_info=...) com
    `.fetch_location_history(keys) -> dict[KeyPair, list[LocationReport]]`
    (não existe `.restore()` nem parâmetro de janela de tempo nesta versão —
    ver findmy/reports/account.py no wheel). `respostas` é um callback
    keys -> dict; `levanta_unauthorized` simula a Apple revogando a sessão.

    Retorna a classe AppleAccountStub para o teste inspecionar quantas vezes
    fetch_location_history foi chamado."""
    findmy = types.ModuleType("findmy")

    class KeyPairStub:
        def __init__(self, private_key_b64):
            self.private_key_b64 = private_key_b64

        @classmethod
        def from_b64(cls, key_b64):
            return cls(key_b64)

    findmy.KeyPair = KeyPairStub

    findmy_errors = types.ModuleType("findmy.errors")

    class UnauthorizedErrorStub(Exception):
        pass

    findmy_errors.UnauthorizedError = UnauthorizedErrorStub

    findmy_reports = types.ModuleType("findmy.reports")

    class RemoteAnisetteProviderStub:
        def __init__(self, server_url):
            self.server_url = server_url

    class AppleAccountStub:
        instancias = []

        def __init__(self, anisette, *, state_info=None):
            self.anisette = anisette
            self.state_info = state_info
            self.chamadas_fetch = 0
            AppleAccountStub.instancias.append(self)

        def fetch_location_history(self, keys):
            self.chamadas_fetch += 1
            if levanta_unauthorized:
                raise UnauthorizedErrorStub("Not authorized to fetch reports.")
            if respostas is None:
                return {}
            return respostas(keys)

    findmy_reports.RemoteAnisetteProvider = RemoteAnisetteProviderStub
    findmy_reports.AppleAccount = AppleAccountStub

    findmy_util = types.ModuleType("findmy.util")
    sys.modules["findmy.util"] = findmy_util
    _stub_http_session()  # registra findmy.util.http com HttpSession._get_session

    sys.modules["findmy"] = findmy
    sys.modules["findmy.errors"] = findmy_errors
    sys.modules["findmy.reports"] = findmy_reports

    return AppleAccountStub


def _importar_apple_client_fresco():
    """Descarta findmy_worker.apple_client do cache e importa de novo, para
    que `from findmy... import ...` no topo do módulo capture o stub
    registrado por _stub_findmy_para_buscar nesta chamada."""
    sys.modules.pop("findmy_worker.apple_client", None)
    return importlib.import_module("findmy_worker.apple_client")


def _preparar_pasta_sessao(tmp_path):
    """account.json no formato AccountStateMapping real (ids/account/login/
    anisette) — o suficiente pra passar pelo `json.loads` de `_sessao()`;
    o stub de AppleAccount não valida o conteúdo."""
    pasta = tmp_path / "sessao-apple"
    pasta.mkdir()
    estado = {
        "type": "account",
        "ids": {"uid": "u", "devid": "d"},
        "account": {"username": "a@b.com", "password": "x", "info": None},
        "login": {"state": 3, "data": {}},
        "anisette": {"type": "aniRemote", "url": "http://anisette-antigo"},
    }
    (pasta / "account.json").write_text(json.dumps(estado), encoding="utf-8")
    return pasta


def test_buscar_normaliza_relatorios_e_filtra_pela_janela_de_backfill(tmp_path):
    # Sem mock de relógio: dentro_da_janela (1h atrás) e fora_da_janela
    # (200h atrás) estão longe o bastante do corte de 24h que uma folga de
    # milissegundos entre montar o relatório e chamar buscar() não altera
    # o resultado do teste.
    agora = datetime.now(timezone.utc)
    dentro_da_janela = _RelatorioStub(-22.9, -43.1, 30, agora - timedelta(hours=1), "hash-a")
    fora_da_janela = _RelatorioStub(-22.9, -43.1, 30, agora - timedelta(hours=200), "hash-a")

    def respostas(keys):
        return {keys[0]: [dentro_da_janela, fora_da_janela]}

    _stub_findmy_para_buscar(respostas=respostas)
    apple_client = _importar_apple_client_fresco()

    cliente = apple_client.AppleClient(_preparar_pasta_sessao(tmp_path), "http://anisette", PROXY)
    tags = [{"privateKey": "priv-a", "hashedAdvKey": "hash-a", "backfillHours": 24}]

    resultado = cliente.buscar(tags, backfill_horas=24)

    assert resultado == [
        {
            "latitude": -22.9,
            "longitude": -43.1,
            "horizontal_accuracy": 30,
            "timestamp": dentro_da_janela.timestamp,
            "hashed_adv_key": "hash-a",
        }
    ]


def test_buscar_marca_sessao_morta_apos_unauthorized_e_nao_consulta_a_apple_de_novo(tmp_path):
    AppleAccountStub = _stub_findmy_para_buscar(levanta_unauthorized=True)
    apple_client = _importar_apple_client_fresco()

    cliente = apple_client.AppleClient(_preparar_pasta_sessao(tmp_path), "http://anisette", PROXY)
    tags = [{"privateKey": "priv-a", "hashedAdvKey": "hash-a", "backfillHours": 24}]

    with pytest.raises(apple_client.ErroDeAutenticacaoApple):
        cliente.buscar(tags, backfill_horas=24)

    with pytest.raises(apple_client.ErroDeAutenticacaoApple):
        cliente.buscar(tags, backfill_horas=24)

    # A segunda chamada nem chega a montar sessão de novo — _sessao_morta
    # curto-circuita antes de qualquer nova consulta à Apple (2FA por SMS
    # quebrado, sem reautenticação automática — ver apple_errors.py).
    assert AppleAccountStub.instancias[0].chamadas_fetch == 1


def test_buscar_restaura_a_sessao_pelo_construtor_sem_chamar_restore(tmp_path):
    """0.10.1 não tem `AppleAccount.restore()` — o estado salvo entra pelo
    construtor via `state_info=`. Como AppleAccountStub não define
    `restore`, chamar esse método faria o teste explodir com AttributeError
    em vez de devolver relatório nenhum."""
    _stub_findmy_para_buscar(respostas=lambda keys: {})
    apple_client = _importar_apple_client_fresco()

    cliente = apple_client.AppleClient(_preparar_pasta_sessao(tmp_path), "http://anisette", PROXY)
    tags = [{"privateKey": "priv-a", "hashedAdvKey": "hash-a", "backfillHours": 1}]

    resultado = cliente.buscar(tags, backfill_horas=1)

    assert resultado == []
