"""
O ciclo do worker.

Regra de fronteira: o backend decide, o worker obedece. Aqui não existe
nenhuma decisão sobre quais TAGs importam ou com que pressa — isso vem pronto
no plano. O ciclo só traduz, deduplica e entrega.
"""
from .report_mapper import relatorio_para_payload


def executar_ciclo(backend, apple, dedupe, outbox, detector, agora) -> dict:
    _drenar_fila(backend, outbox)

    plano = backend.plano()
    tags = plano.get("tags", [])
    if not tags:
        detector.registrar_ciclo(False, agora)
        return {"enviados": 0, "enfileirados": 0, "silencio_suspeito": False}

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
    }


def _drenar_fila(backend, outbox) -> None:
    for caminho, payload in outbox.pendentes():
        try:
            backend.enviar(payload)
            outbox.remover(caminho)
        except Exception:
            return
