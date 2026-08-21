"""
Testa o monkeypatch que instala o proxy dentro do FindMy.py
(findmy_worker.apple_client._instalar_proxy_no_findmy) sem depender da lib
`findmy` de verdade — ela não está instalada neste ambiente e não pode ser.

Em vez disso, injetamos em sys.modules um `findmy` de mentira com a mesma
forma (findmy.KeyPair, findmy.reports.RemoteAnisetteProvider/AppleAccount,
findmy.util.http.HttpSession._get_session) só o suficiente pra importar
apple_client.py e exercitar o instalador do proxy.
"""
import os
import sys
import types

import pytest

PROXY = "http://usuario:senha@proxy-residencial:8080"


def _stub_findmy_base():
    """Stub mínimo pro `from findmy import KeyPair` / `from findmy.reports
    import ...` que apple_client.py faz no topo do arquivo. Não é o alvo do
    teste — só existe pra permitir importar o módulo sem a lib real."""
    findmy = types.ModuleType("findmy")
    findmy.KeyPair = object
    findmy_reports = types.ModuleType("findmy.reports")
    findmy_reports.RemoteAnisetteProvider = object
    findmy_reports.AppleAccount = object
    findmy_util = types.ModuleType("findmy.util")

    sys.modules["findmy"] = findmy
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
