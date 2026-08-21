from datetime import datetime, timezone

from findmy_worker.report_mapper import relatorio_para_payload


def test_traduz_relatorio_da_apple_para_o_formato_do_backend():
    relatorio = {
        "latitude": -22.9068,
        "longitude": -43.1729,
        "horizontal_accuracy": 40,
        "timestamp": datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc),
        "hashed_adv_key": "ub1FoLtdoAnRgH1/u9qjYETb5SNN1pJ/gXdWR1QNsUY=",
    }

    payload = relatorio_para_payload(relatorio, "92603008494")

    assert payload["deviceImei"] == "92603008494"
    assert payload["scannerLat"] == -22.9068
    assert payload["scannerLng"] == -43.1729
    assert payload["accuracy"] == 40
    assert payload["seenAt"] == "2026-08-20T10:00:00+00:00"
    assert payload["scannerSource"] == "apple-findmy"
    assert "rssi" not in payload


def test_relatorio_sem_precisao_nao_inventa_numero():
    relatorio = {
        "latitude": -22.9,
        "longitude": -43.1,
        "horizontal_accuracy": None,
        "timestamp": datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc),
        "hashed_adv_key": "abc",
    }

    payload = relatorio_para_payload(relatorio, "92603008494")

    assert "accuracy" not in payload


def test_precisao_negativa_e_omitida_sem_perder_a_posicao():
    """Backend valida accuracy com @Min(0) — um valor negativo vindo da
    Apple rejeitaria o payload inteiro (posição e tudo) se fosse enviado
    junto. Perder a precisão é aceitável; perder a posição não é."""
    relatorio = {
        "latitude": -22.9,
        "longitude": -43.1,
        "horizontal_accuracy": -1,
        "timestamp": datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc),
        "hashed_adv_key": "abc",
    }

    payload = relatorio_para_payload(relatorio, "92603008494")

    assert "accuracy" not in payload
    assert payload["scannerLat"] == -22.9
    assert payload["scannerLng"] == -43.1


def test_precisao_nao_numerica_e_omitida_sem_perder_a_posicao():
    relatorio = {
        "latitude": -22.9,
        "longitude": -43.1,
        "horizontal_accuracy": float("nan"),
        "timestamp": datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc),
        "hashed_adv_key": "abc",
    }

    payload = relatorio_para_payload(relatorio, "92603008494")

    assert "accuracy" not in payload
    assert payload["scannerLat"] == -22.9


def test_precisao_zero_e_aceita():
    relatorio = {
        "latitude": -22.9,
        "longitude": -43.1,
        "horizontal_accuracy": 0,
        "timestamp": datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc),
        "hashed_adv_key": "abc",
    }

    payload = relatorio_para_payload(relatorio, "92603008494")

    assert payload["accuracy"] == 0


def test_timestamp_sem_fuso_e_tratado_como_utc():
    relatorio = {
        "latitude": -22.9,
        "longitude": -43.1,
        "horizontal_accuracy": 10,
        "timestamp": datetime(2026, 8, 20, 10, 0),
        "hashed_adv_key": "abc",
    }

    payload = relatorio_para_payload(relatorio, "92603008494")

    assert payload["seenAt"].endswith("+00:00")
