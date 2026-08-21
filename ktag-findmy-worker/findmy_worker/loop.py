"""
O ciclo do worker.

Regra de fronteira: o backend decide, o worker obedece. Aqui não existe
nenhuma decisão sobre quais TAGs importam ou com que pressa — isso vem pronto
no plano. O ciclo só traduz, deduplica e entrega.
"""
import logging

from .backend_client import ErroPermanente, ErroTransitorio
from .report_mapper import relatorio_para_payload

logger = logging.getLogger(__name__)


def executar_ciclo(backend, apple, dedupe, outbox, detector, agora) -> dict:
    _drenar_fila(backend, outbox)

    plano = backend.plano()
    tags = plano.get("tags", [])
    if not tags:
        detector.registrar_ciclo(False, agora)
        return {
            "enviados": 0,
            "enfileirados": 0,
            "silencio_suspeito": False,
            "pendentes": len(outbox.pendentes()),
        }

    backfill = max(t.get("backfillHours", 0) for t in tags)
    relatorios = apple.buscar(tags, backfill)

    por_chave = {t["hashedAdvKey"]: t["deviceImei"] for t in tags}

    enviados = 0
    enfileirados = 0
    for relatorio in relatorios:
        imei = por_chave.get(relatorio["hashed_adv_key"])
        if imei is None:
            continue

        payload = relatorio_para_payload(relatorio, imei)
        if dedupe.ja_enviado(payload):
            continue

        try:
            backend.enviar(payload)
            enviados += 1
        except Exception:
            outbox.guardar(payload)
            enfileirados += 1

        dedupe.marcar(payload)

    suspeito = detector.registrar_ciclo(bool(relatorios), agora)

    return {
        "enviados": enviados,
        "enfileirados": enfileirados,
        "silencio_suspeito": suspeito,
        "pendentes": len(outbox.pendentes()),
    }


def _drenar_fila(backend, outbox) -> None:
    """Percorre a fila em disco tentando reenviar. Erro permanente (o
    backend rejeitou aquele conteúdo especificamente) não pode travar os
    itens atrás dele — vai pra quarentena e a varredura continua. Erro
    transitório (backend fora do ar) é motivo pra parar e tentar tudo de
    novo no próximo ciclo, não pra descartar nada."""
    for caminho, payload in outbox.pendentes():
        try:
            backend.enviar(payload)
            outbox.remover(caminho)
        except ErroPermanente as erro:
            logger.warning("payload rejeitado em definitivo pelo backend, indo para quarentena: %s", erro)
            outbox.quarentenar(caminho, str(erro))
        except ErroTransitorio as erro:
            logger.warning(
                "backend indisponível ao drenar a fila, %s item(ns) continuam pendentes: %s",
                len(outbox.pendentes()), erro,
            )
            return
        except Exception as erro:
            logger.warning(
                "falha inesperada ao drenar a fila, tratando como transitória; "
                "%s item(ns) continuam pendentes: %s",
                len(outbox.pendentes()), erro,
            )
            return
