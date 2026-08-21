from findmy_worker.dedupe import Dedupe


def payload(seen_at="2026-08-20T10:00:00+00:00", chave="abc"):
    return {
        "deviceImei": "92603008494",
        "hashedAdvKey": chave,
        "seenAt": seen_at,
        "scannerLat": -22.9,
        "scannerLng": -43.1,
    }


def test_o_mesmo_relatorio_nao_e_enviado_duas_vezes():
    d = Dedupe()
    p = payload()

    assert d.ja_enviado(p) is False
    d.marcar(p)
    assert d.ja_enviado(p) is True


def test_relatorio_de_outro_instante_passa():
    d = Dedupe()
    d.marcar(payload())

    assert d.ja_enviado(payload(seen_at="2026-08-20T10:05:00+00:00")) is False


def test_relatorio_de_outra_tag_no_mesmo_instante_passa():
    d = Dedupe()
    d.marcar(payload())

    assert d.ja_enviado(payload(chave="xyz")) is False


def test_memoria_nao_cresce_sem_limite():
    d = Dedupe(limite=10)
    for i in range(50):
        d.marcar(payload(seen_at=f"2026-08-20T10:{i:02d}:00+00:00"))

    assert len(d) <= 10
    assert d.ja_enviado(payload(seen_at="2026-08-20T10:49:00+00:00")) is True
