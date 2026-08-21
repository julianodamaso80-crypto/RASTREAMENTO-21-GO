"""
Fala com o backend do 21 GO.

O tráfego para o nosso backend NÃO passa pelo proxy residencial: o proxy
existe só para a Apple, que barra IP de datacenter.
"""
import httpx


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
        resposta = self._http.post("/ble-tags/sightings", json=payload)
        resposta.raise_for_status()
