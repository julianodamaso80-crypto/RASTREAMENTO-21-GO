from findmy_worker.outbox import Outbox


def test_payload_guardado_volta_igual(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1", "seenAt": "2026-08-20T10:00:00+00:00"})

    pendentes = caixa.pendentes()

    assert len(pendentes) == 1
    assert pendentes[0][1]["deviceImei"] == "1"


def test_sobrevive_a_reinicio_do_processo(tmp_path):
    Outbox(tmp_path).guardar({"deviceImei": "1"})

    assert len(Outbox(tmp_path).pendentes()) == 1


def test_removido_nao_volta(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1"})
    caminho, _ = caixa.pendentes()[0]

    caixa.remover(caminho)

    assert caixa.pendentes() == []


def test_dois_payloads_no_mesmo_instante_nao_se_sobrescrevem(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1"})
    caixa.guardar({"deviceImei": "2"})

    assert len(caixa.pendentes()) == 2
