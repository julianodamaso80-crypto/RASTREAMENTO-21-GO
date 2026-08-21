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


def test_arquivo_corrompido_nao_e_apagado(tmp_path):
    """Um JSON truncado (ex.: processo morto no meio da escrita) precisa ir
    pra quarentena, nunca sumir sem deixar rastro."""
    caixa = Outbox(tmp_path)
    corrompido = tmp_path / "corrompido.json"
    corrompido.write_text("{nao e json valido", encoding="utf-8")

    caixa.pendentes()

    assert not corrompido.exists()
    assert (tmp_path / "corrompidos" / "corrompido.json").exists()


def test_pendentes_retorna_validos_mesmo_com_corrompido_ao_lado(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1"})
    (tmp_path / "corrompido.json").write_text("{nao e json valido", encoding="utf-8")

    pendentes = caixa.pendentes()

    assert len(pendentes) == 1
    assert pendentes[0][1]["deviceImei"] == "1"


def test_pasta_corrompidos_nao_quebra_pendentes_e_nunca_e_listada(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1"})
    (tmp_path / "corrompido.json").write_text("{nao e json valido", encoding="utf-8")

    caixa.pendentes()
    pendentes = caixa.pendentes()

    assert len(pendentes) == 1


def test_guardar_nao_deixa_tmp_solto_em_pendentes(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1"})

    assert list(tmp_path.glob("*.tmp")) == []
    assert len(caixa.pendentes()) == 1
