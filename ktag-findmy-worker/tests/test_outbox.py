import uuid

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


def test_tmp_orfao_e_colocado_em_quarentena_ao_construir_outbox(tmp_path):
    """Processo morto entre write_text e os.replace deixa um .tmp solto.
    O construtor varre a pasta no boot e coloca isso em quarentena, porque
    nesse momento o .tmp só pode pertencer a um processo que já morreu."""
    orfao = tmp_path / f"{uuid.uuid4().hex}.tmp"
    orfao.write_text('{"deviceImei": "1"}', encoding="utf-8")

    Outbox(tmp_path)

    assert not orfao.exists()
    assert (tmp_path / "corrompidos" / orfao.name).exists()


def test_varredura_do_construtor_nao_mexe_em_json_valido_ao_lado(tmp_path):
    Outbox(tmp_path).guardar({"deviceImei": "1"})
    orfao = tmp_path / f"{uuid.uuid4().hex}.tmp"
    orfao.write_text('{"deviceImei": "2"}', encoding="utf-8")

    caixa = Outbox(tmp_path)

    assert len(caixa.pendentes()) == 1


def test_quarentenados_conta_arquivos_json_e_tmp_orfaos(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "venenoso"})
    caminho, _ = caixa.pendentes()[0]
    caixa.quarentenar(caminho, "rejeitado pelo backend")

    orfao = tmp_path / f"{uuid.uuid4().hex}.tmp"
    orfao.write_text('{"deviceImei": "2"}', encoding="utf-8")
    Outbox(tmp_path)  # varre o .tmp orfao no boot e joga pra quarentena tambem

    assert len(Outbox(tmp_path).quarentenados()) == 2


def test_arquivo_com_utf8_invalido_e_colocado_em_quarentena_por_pendentes(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1"})
    invalido = tmp_path / "invalido.json"
    invalido.write_bytes(b"\xff\xfe\x00nao-e-utf8")

    pendentes = caixa.pendentes()

    assert len(pendentes) == 1
    assert pendentes[0][1]["deviceImei"] == "1"
    assert not invalido.exists()
    assert (tmp_path / "corrompidos" / "invalido.json").exists()
