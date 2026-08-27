"""
Worker Find My do 21 GO.

Fecha o circuito da TAG: pergunta ao backend quais TAGs merecem consulta
agora, busca os relatórios na rede Find My, decifra com a chave de cada uma e
devolve as posições para o backend por POST /ble-tags/sightings.

Duas regras aqui não são detalhe de implementação, são o que mantém a conta
Apple viva:

  1. Quem decide o que consultar é o BACKEND, não este worker. O endpoint
     /ble-tags/polling-plan já devolve só as TAGs em ritmo acelerado — TAG em
     repouso não custa requisição nenhuma. Consultar a frota inteira "porque
     sim" é exatamente o padrão que bane a conta.

  2. O intervalo mínimo é de 30 minutos. Foi medido pelo autor da FindMy.py:
     de 5 a 10 minutos derruba a conta; 15 a 30 é seguro. E como a latência da
     própria rede é de 8 a 47 minutos, consultar mais rápido não traria
     posição mais nova — só risco.

Rodar:  python worker.py
"""
import logging
import os
import time

import httpx

from decoder_client import DecoderIndisponivel, fetch_reports
from findmy_crypto import decrypt_report

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("worker-findmy")

API_BASE = os.getenv("API_BASE_URL", "http://localhost:3001").rstrip("/")
API_PREFIX = os.getenv("API_PREFIX", "/api/v1")
JWT = os.getenv("JWT_TOKEN", "").strip()
DECODER_BASE = os.getenv("DECODER_BASE_URL", "http://localhost:6176").rstrip("/")
DECODER_USER = os.getenv("DECODER_USER", "").strip()
DECODER_PASS = os.getenv("DECODER_PASS", "").strip()

# Piso de segurança. Mesmo que alguém configure menos, o worker não obedece.
INTERVALO_MINIMO_S = 1800
INTERVALO_S = max(
    INTERVALO_MINIMO_S, int(os.getenv("WORKER_INTERVAL_S", INTERVALO_MINIMO_S))
)
JANELA_MAX_DIAS = 7  # é tudo que a Apple guarda

ORIGEM = "apple-findmy"


def _headers() -> dict:
    return {"Authorization": f"Bearer {JWT}"}


def _url(caminho: str) -> str:
    return f"{API_BASE}{API_PREFIX}{caminho}"


def carregar_plano() -> list[dict]:
    """
    O que o backend mandou consultar agora.

    Formato de cada item (ver BleTagsService.getPollingPlan):
      deviceImei, privateKey, hashedAdvKey, mode, intervalSeconds, backfillHours
    """
    resposta = httpx.get(
        _url("/ble-tags/polling-plan"), headers=_headers(), timeout=30
    )
    resposta.raise_for_status()
    corpo = resposta.json()
    # O backend envelopa em { data: ... } quando a resposta não é paginada.
    dados = corpo.get("data", corpo)
    return dados.get("tags", [])


def janela_em_dias(plano: list[dict]) -> int:
    """
    Uma consulta serve todas as TAGs, então a janela é a maior pedida —
    limitada aos 7 dias que a Apple guarda.
    """
    horas = max((t.get("backfillHours") or 24) for t in plano)
    return max(1, min(JANELA_MAX_DIAS, round(horas / 24)))


def montar_payloads(reports: list[dict], plano: list[dict]) -> list[dict]:
    """
    Relatórios cifrados viram corpos de POST /ble-tags/sightings.

    Relatório que não abre é registrado e descartado: uma TAG com chave errada
    não pode derrubar a coleta das outras.
    """
    por_hash = {
        t["hashedAdvKey"]: t
        for t in plano
        if t.get("hashedAdvKey") and t.get("privateKey")
    }
    payloads = []

    for report in reports:
        tag = por_hash.get(report["id"])
        if not tag:
            # Chave que não pedimos (ou que saiu do plano no meio do ciclo).
            continue
        try:
            aberto = decrypt_report(report["payload"], tag["privateKey"])
        except Exception as erro:
            log.warning(
                "relatório não abriu para a TAG %s: %s", tag["deviceImei"], erro
            )
            continue

        payloads.append(
            {
                "deviceImei": tag["deviceImei"],
                "hashedAdvKey": report["id"],
                "seenAt": aberto["isodatetime"],
                "scannerLat": aberto["lat"],
                "scannerLng": aberto["lon"],
                # `conf` da rede é o raio de confiança em metros.
                "accuracy": int(aberto["conf"]),
                "scannerSource": ORIGEM,
            }
        )

    return payloads


def deduplicar(payloads: list[dict]) -> list[dict]:
    """
    O backfill reenvia a mesma janela a cada ciclo. O backend já dedupe por
    (hashedAdvKey, seenAt), mas filtrar aqui poupa centenas de requisições
    inúteis por ciclo.
    """
    vistos = set()
    saida = []
    for p in payloads:
        chave = (p["deviceImei"], p["hashedAdvKey"], p["seenAt"])
        if chave in vistos:
            continue
        vistos.add(chave)
        saida.append(p)
    return saida


def postar(payloads: list[dict]) -> tuple[int, int]:
    """Devolve (aceitos, falhos). Falha de um não interrompe os outros."""
    aceitos = falhos = 0
    with httpx.Client(headers=_headers(), timeout=30) as cliente:
        for p in payloads:
            try:
                r = cliente.post(_url("/ble-tags/sightings"), json=p)
                r.raise_for_status()
                aceitos += 1
            except httpx.HTTPError as erro:
                falhos += 1
                log.warning(
                    "falha ao enviar avistamento de %s: %s", p["deviceImei"], erro
                )
    return aceitos, falhos


def ciclo() -> None:
    plano = carregar_plano()
    if not plano:
        log.info("nenhuma TAG em ritmo acelerado — nada a consultar neste ciclo")
        return

    dias = janela_em_dias(plano)
    chaves = [t["hashedAdvKey"] for t in plano if t.get("hashedAdvKey")]
    log.info("consultando %d TAG(s), janela de %d dia(s)", len(chaves), dias)

    auth = (DECODER_USER, DECODER_PASS) if DECODER_USER or DECODER_PASS else None
    reports = fetch_reports(chaves, dias, DECODER_BASE, auth)
    log.info("%d relatório(s) recebido(s) da rede Find My", len(reports))

    payloads = deduplicar(montar_payloads(reports, plano))
    if not payloads:
        log.info("nenhum avistamento novo para enviar")
        return

    aceitos, falhos = postar(payloads)
    log.info("avistamentos enviados: %d aceitos, %d falhos", aceitos, falhos)


def main() -> None:
    if not JWT:
        raise SystemExit("JWT_TOKEN não configurado — o worker não sobe sem ele.")

    log.info(
        "worker Find My no ar: API=%s decoder=%s intervalo=%ds",
        API_BASE,
        DECODER_BASE,
        INTERVALO_S,
    )
    while True:
        try:
            ciclo()
        except DecoderIndisponivel as erro:
            log.error("decoder fora do ar: %s", erro)
        except httpx.HTTPError as erro:
            log.error("backend não respondeu: %s", erro)
        except Exception:
            log.exception("falha inesperada no ciclo")
        time.sleep(INTERVALO_S)


if __name__ == "__main__":
    main()
