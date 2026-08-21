"""
Entrypoint do worker: monta as peças, roda o ciclo e dorme o que o backend mandou.

O intervalo não é decidido aqui — vem no plano. Se alguma TAG está em ritmo
acelerado, o ciclo inteiro roda no ritmo dela.
"""
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from .apple_client import AppleClient
from .backend_client import BackendClient, ErroDeCredencial
from .backfill import RastreadorDeBackfill
from .dedupe import Dedupe
from .loop import executar_ciclo
from .outbox import Outbox
from .silence import DetectorDeSilencio

INTERVALO_PADRAO_S = 3600
INTERVALO_APOS_ERRO_S = 300

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("ktag-worker")


def _intervalo_do_plano(backend) -> int:
    try:
        tags = backend.plano().get("tags", [])
    except Exception:
        return INTERVALO_PADRAO_S
    if not tags:
        return INTERVALO_PADRAO_S
    return min(t.get("intervalSeconds", INTERVALO_PADRAO_S) for t in tags)


def main() -> None:
    load_dotenv()

    backend = BackendClient(os.environ["BACKEND_URL"], os.environ["BACKEND_TOKEN"])
    apple = AppleClient(
        pasta_sessao=Path(os.environ["APPLE_SESSION_DIR"]),
        anisette_url=os.environ["ANISETTE_URL"],
        proxy=os.environ.get("APPLE_PROXY", ""),
    )
    outbox = Outbox(Path(os.environ["OUTBOX_DIR"]))
    dedupe = Dedupe()
    detector = DetectorDeSilencio()
    rastreador_backfill = RastreadorDeBackfill()

    log.info("worker da K-Tag iniciado")

    while True:
        try:
            resultado = executar_ciclo(
                backend, apple, dedupe, outbox, detector,
                datetime.now(timezone.utc), rastreador_backfill,
            )
            log.info(
                "ciclo: %s enviados, %s enfileirados, %s pendentes na fila, "
                "%s em quarentena, %s sem TAG correspondente",
                resultado["enviados"],
                resultado["enfileirados"],
                resultado["pendentes"],
                resultado["quarentena"],
                resultado["nao_correspondidos"],
            )
            if resultado["silencio_suspeito"]:
                log.error(
                    "SILENCIO SUSPEITO: nenhuma TAG reportou na janela. "
                    "Provavel bloqueio do IP do proxy pela Apple — conferir antes "
                    "de assumir que as TAGs estao fora de area."
                )
            if not resultado["apple_autenticado"]:
                log.error(
                    "SESSAO DA APPLE INVALIDA: a Apple recusou a autenticacao "
                    "(sessao expirada ou revogada). O worker PAROU de consultar "
                    "a Apple e vai continuar parado ate o processo ser reiniciado "
                    "com uma sessao nova — login manual com --trusteddevice (o "
                    "2FA por SMS esta quebrado, nao existe reautenticacao "
                    "automatica). Nenhuma TAG tera posicao nova ate isso ser feito."
                )
            espera = _intervalo_do_plano(backend)
        except ErroDeCredencial:
            log.error(
                "TOKEN DO BACKEND EXPIROU OU FOI REVOGADO: o worker esta CEGO "
                "agora, sem conseguir ler o plano nem entregar posicao nenhuma. "
                "BACKEND_TOKEN e um JWT de staff com validade de 12h — gere um "
                "token novo e atualize a variavel de ambiente do worker. Vou "
                "continuar tentando a cada %s s ate isso acontecer.",
                INTERVALO_APOS_ERRO_S,
            )
            espera = INTERVALO_APOS_ERRO_S
        except Exception:
            log.exception("ciclo falhou")
            espera = INTERVALO_APOS_ERRO_S

        time.sleep(espera)


if __name__ == "__main__":
    main()
