"""
Testa a classificação de status HTTP em findmy_worker.backend_client.BackendClient.

BackendClient.enviar() decide entre "guardar para reenviar" (ErroTransitorio),
"quarentenar para sempre" (ErroPermanente) e "worker está cego" (ErroDeCredencial)
— entre manter e perder uma posição de veículo roubado. Isso não pode ficar
coberto só por stub indireto em teste de outro módulo.

Usa httpx.MockTransport (a lib já é dependência) para simular as respostas do
backend sem rede de verdade.
"""
import httpx
import pytest

from findmy_worker.backend_client import BackendClient, ErroDeCredencial, ErroPermanente, ErroTransitorio


def _cliente_com_resposta(handler) -> BackendClient:
    cliente = BackendClient("https://backend.invalido", "token-fake")
    cliente._http = httpx.Client(
        base_url="https://backend.invalido",
        headers={"Authorization": "Bearer token-fake"},
        transport=httpx.MockTransport(handler),
    )
    return cliente


def _cliente_que_derruba_conexao() -> BackendClient:
    def handler(request):
        raise httpx.ConnectError("conexão recusada", request=request)

    return _cliente_com_resposta(handler)


@pytest.mark.parametrize("status", [200, 201])
def test_enviar_sucesso_nao_levanta_nada(status):
    def handler(request):
        return httpx.Response(status)

    cliente = _cliente_com_resposta(handler)

    cliente.enviar({"deviceImei": "1"})  # não deve levantar


@pytest.mark.parametrize("status", [400, 404, 422])
def test_enviar_4xx_comum_e_permanente(status):
    def handler(request):
        return httpx.Response(status)

    cliente = _cliente_com_resposta(handler)

    with pytest.raises(ErroPermanente):
        cliente.enviar({"deviceImei": "1"})


@pytest.mark.parametrize("status", [408, 429])
def test_enviar_408_e_429_sao_transitorios_nao_permanentes(status):
    def handler(request):
        return httpx.Response(status)

    cliente = _cliente_com_resposta(handler)

    with pytest.raises(ErroTransitorio):
        cliente.enviar({"deviceImei": "1"})


@pytest.mark.parametrize("status", [500, 502, 503])
def test_enviar_5xx_e_transitorio(status):
    def handler(request):
        return httpx.Response(status)

    cliente = _cliente_com_resposta(handler)

    with pytest.raises(ErroTransitorio):
        cliente.enviar({"deviceImei": "1"})


def test_enviar_erro_de_conexao_e_transitorio():
    cliente = _cliente_que_derruba_conexao()

    with pytest.raises(ErroTransitorio):
        cliente.enviar({"deviceImei": "1"})


@pytest.mark.parametrize("status", [401, 403])
def test_enviar_401_e_403_sao_erro_de_credencial(status):
    def handler(request):
        return httpx.Response(status)

    cliente = _cliente_com_resposta(handler)

    with pytest.raises(ErroDeCredencial):
        cliente.enviar({"deviceImei": "1"})


@pytest.mark.parametrize("status", [401, 403])
def test_plano_401_e_403_tambem_sao_erro_de_credencial(status):
    def handler(request):
        return httpx.Response(status)

    cliente = _cliente_com_resposta(handler)

    with pytest.raises(ErroDeCredencial):
        cliente.plano()


def test_plano_sucesso_devolve_o_json():
    def handler(request):
        return httpx.Response(200, json={"tags": []})

    cliente = _cliente_com_resposta(handler)

    assert cliente.plano() == {"tags": []}
