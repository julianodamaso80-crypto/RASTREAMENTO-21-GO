"""
Fala com a rede Find My via FindMy.py, saindo pelo proxy residencial.

A Apple bloqueia consulta de Find My vinda de datacenter — DigitalOcean
incluída. Sem proxy, o login retorna 200 OK e a busca devolve lista vazia, o
que é indistinguível de "ninguém viu a TAG". Por isso o worker se recusa a
consultar sem proxy configurado.
"""
from datetime import timedelta
from pathlib import Path

from findmy import KeyPair
from findmy.reports import RemoteAnisetteProvider, AppleAccount


class AppleClient:
    def __init__(self, pasta_sessao: Path, anisette_url: str, proxy: str):
        if not proxy:
            raise ValueError(
                "Proxy residencial não configurado. Consultar a Apple pelo IP "
                "do droplet devolve lista vazia silenciosamente."
            )
        self._pasta_sessao = Path(pasta_sessao)
        self._anisette = RemoteAnisetteProvider(anisette_url)
        self._proxy = proxy
        self._conta = None

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
        conta = self._sessao()
        chaves = [KeyPair.from_b64(t["privateKey"]) for t in tags]
        janela = timedelta(hours=backfill_horas or 1)

        relatorios = conta.fetch_last_reports(chaves, hours=int(janela.total_seconds() // 3600))

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
