"""
O ciclo do worker.

Regra de fronteira: o backend decide, o worker obedece. Aqui não existe
nenhuma decisão sobre quais TAGs importam ou com que pressa — isso vem pronto
no plano. O ciclo só traduz, deduplica e entrega.

Este módulo nunca importa findmy_worker.apple_client (nem a lib `findmy`):
ela nem sempre está instalada, e o `apple` recebido aqui é só um objeto com
um método `buscar(tags, backfill_horas)` — duck typing de propósito.
"""
import logging

from .apple_errors import ErroDeAutenticacaoApple
from .backend_client import ErroDeCredencial, ErroPermanente, ErroTransitorio
from .backfill import RastreadorDeBackfill
from .report_mapper import relatorio_para_payload

logger = logging.getLogger(__name__)


def executar_ciclo(backend, apple, dedupe, outbox, detector, agora, rastreador_backfill=None) -> dict:
    if rastreador_backfill is None:
        rastreador_backfill = RastreadorDeBackfill()

    _drenar_fila(backend, outbox)

    plano = backend.plano()
    tags = plano.get("tags", [])
    if not tags:
        # Plano vazio não é silêncio nem avistamento — é "ninguém cadastrou
        # chave ainda". Alimentar o detector aqui faria ele alarmar bloqueio
        # de IP num ambiente que nunca teve nada pra achar.
        return {
            "enviados": 0,
            "enfileirados": 0,
            "silencio_suspeito": False,
            "pendentes": len(outbox.pendentes()),
            "quarentena": len(outbox.quarentenados()),
            "nao_correspondidos": 0,
            "apple_autenticado": True,
        }

    backfill = rastreador_backfill.horas_para_o_ciclo(tags)

    try:
        relatorios = apple.buscar(tags, backfill)
    except ErroDeAutenticacaoApple:
        # Mesma lógica do plano vazio: sem sessão válida não há como saber
        # se as TAGs estão em silêncio de verdade. main.py decide o alarme
        # olhando para "apple_autenticado".
        return {
            "enviados": 0,
            "enfileirados": 0,
            "silencio_suspeito": False,
            "pendentes": len(outbox.pendentes()),
            "quarentena": len(outbox.quarentenados()),
            "nao_correspondidos": 0,
            "apple_autenticado": False,
        }

    rastreador_backfill.atualizar(tags)

    por_chave = {t["hashedAdvKey"]: t["deviceImei"] for t in tags}

    enviados = 0
    enfileirados = 0
    nao_correspondidos = 0
    exemplo_chave_sem_match = None
    for relatorio in relatorios:
        imei = por_chave.get(relatorio["hashed_adv_key"])
        if imei is None:
            nao_correspondidos += 1
            if exemplo_chave_sem_match is None:
                exemplo_chave_sem_match = relatorio["hashed_adv_key"]
            continue

        payload = relatorio_para_payload(relatorio, imei)
        if dedupe.ja_enviado(payload):
            continue

        try:
            backend.enviar(payload)
            enviados += 1
        except ErroDeCredencial:
            raise
        except Exception:
            outbox.guardar(payload)
            enfileirados += 1

        dedupe.marcar(payload)

    if nao_correspondidos:
        # As chaves são cadastradas à mão (Device.bleAdvKeyHashed) — um
        # encoding diferente do que a Apple devolve derruba 100% dos
        # relatórios e o ciclo reporta "enviados: 0", indistinguível de
        # "nenhuma TAG foi vista". Isso precisa ficar visível.
        logger.warning(
            "%s relatorio(s) da Apple sem TAG correspondente no plano — "
            "possivel divergencia de encoding na chave cadastrada a mao; "
            "exemplo de chave sem match: %s",
            nao_correspondidos, exemplo_chave_sem_match,
        )

    suspeito = detector.registrar_ciclo(bool(relatorios), agora)

    return {
        "enviados": enviados,
        "enfileirados": enfileirados,
        "silencio_suspeito": suspeito,
        "pendentes": len(outbox.pendentes()),
        "quarentena": len(outbox.quarentenados()),
        "nao_correspondidos": nao_correspondidos,
        "apple_autenticado": True,
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
        except ErroDeCredencial:
            # Token caiu no meio da drenagem — não é uma falha comum de
            # rede/conteúdo, é o worker ficando cego. Sobe pro main.py
            # tratar como tal em vez de virar mais um "transitório" mudo.
            raise
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
