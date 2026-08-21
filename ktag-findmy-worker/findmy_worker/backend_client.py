"""
Fala com o backend do 21 GO.

O tráfego para o nosso backend NÃO passa pelo proxy residencial: o proxy
existe só para a Apple, que barra IP de datacenter.
"""
import httpx


class ErroPermanente(Exception):
    """O backend rejeitou o conteúdo do payload (4xx que não é 408/429).

    Repetir o envio não muda o resultado — o item precisa sair da fila
    (quarentena), senão trava tudo que está atrás dele para sempre."""


class ErroTransitorio(Exception):
    """Falha que pode se resolver sozinha: backend fora do ar, timeout,
    erro de rede, ou 408/429 (o backend pediu para tentar de novo depois).
    O item continua na fila e é reenviado no próximo ciclo."""


class BackendClient:
    def __init__(self, base_url: str, token: str, timeout: float = 30.0):
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
            trust_env=False,
        )

    def plano(self) -> dict:
        resposta = self._http.get("/ble-tags/polling-plan")
        resposta.raise_for_status()
        return resposta.json()

    def enviar(self, payload: dict) -> None:
        try:
            resposta = self._http.post("/ble-tags/sightings", json=payload)
            resposta.raise_for_status()
        except httpx.HTTPStatusError as erro:
            status = erro.response.status_code
            if 400 <= status < 500 and status not in (408, 429):
                raise ErroPermanente(
                    f"backend rejeitou o payload (HTTP {status}): {erro}"
                ) from erro
            raise ErroTransitorio(
                f"falha temporária ao enviar (HTTP {status}): {erro}"
            ) from erro
        except httpx.HTTPError as erro:
            raise ErroTransitorio(f"falha de rede ao enviar: {erro}") from erro
