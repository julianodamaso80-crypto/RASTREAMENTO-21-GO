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
from .backend_client import BackendClient
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

    log.info("worker da K-Tag iniciado")

    while True:
        try:
            resultado = executar_ciclo(
                backend, apple, dedupe, outbox, detector,
                datetime.now(timezone.utc),
            )
            log.info(
                "ciclo: %s enviados, %s enfileirados, %s pendentes na fila",
                resultado["enviados"],
                resultado["enfileirados"],
                resultado["pendentes"],
            )
            if resultado["silencio_suspeito"]:
                log.error(
                    "SILENCIO SUSPEITO: nenhuma TAG reportou na janela. "
                    "Provavel bloqueio do IP do proxy pela Apple — conferir antes "
                    "de assumir que as TAGs estao fora de area."
                )
            espera = _intervalo_do_plano(backend)
        except Exception:
            log.exception("ciclo falhou")
            espera = INTERVALO_APOS_ERRO_S

        time.sleep(espera)


if __name__ == "__main__":
    main()
