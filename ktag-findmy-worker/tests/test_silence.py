from datetime import datetime, timedelta, timezone

from findmy_worker.silence import DetectorDeSilencio

INICIO = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)


def test_nao_alarma_enquanto_a_janela_nao_fecha():
    d = DetectorDeSilencio(janela_horas=6)

    assert d.registrar_ciclo(False, INICIO) is False
    assert d.registrar_ciclo(False, INICIO + timedelta(hours=5)) is False


def test_alarma_depois_de_seis_horas_sem_nenhum_relatorio():
    d = DetectorDeSilencio(janela_horas=6)
    d.registrar_ciclo(False, INICIO)

    assert d.registrar_ciclo(False, INICIO + timedelta(hours=6, minutes=1)) is True


def test_um_relatorio_de_qualquer_tag_zera_a_contagem():
    d = DetectorDeSilencio(janela_horas=6)
    d.registrar_ciclo(False, INICIO)
    d.registrar_ciclo(True, INICIO + timedelta(hours=5))

    assert d.registrar_ciclo(False, INICIO + timedelta(hours=7)) is False


def test_nao_alarma_repetido_sem_novo_periodo_de_silencio():
    d = DetectorDeSilencio(janela_horas=6)
    d.registrar_ciclo(False, INICIO)
    assert d.registrar_ciclo(False, INICIO + timedelta(hours=7)) is True
    assert d.registrar_ciclo(False, INICIO + timedelta(hours=8)) is False


def test_alarme_rearma_depois_de_mais_uma_janela_inteira_de_silencio():
    """Bloqueio de IP permanente não pode virar um único log.error perdido
    na hora seis — o alarme precisa repetir enquanto o silêncio continuar."""
    d = DetectorDeSilencio(janela_horas=6)
    d.registrar_ciclo(False, INICIO)
    assert d.registrar_ciclo(False, INICIO + timedelta(hours=7)) is True

    assert d.registrar_ciclo(False, INICIO + timedelta(hours=12)) is False
    assert d.registrar_ciclo(False, INICIO + timedelta(hours=13, minutes=1)) is True


def test_relatorio_apos_rearme_zera_tudo_de_novo():
    d = DetectorDeSilencio(janela_horas=6)
    d.registrar_ciclo(False, INICIO)
    d.registrar_ciclo(False, INICIO + timedelta(hours=7))
    d.registrar_ciclo(True, INICIO + timedelta(hours=13, minutes=1))

    assert d.registrar_ciclo(False, INICIO + timedelta(hours=14)) is False
