"""
O worker, sem Apple e sem backend.

Cobre o que dá para errar em silêncio: mapear o relatório para a TAG errada,
deixar um relatório podre derrubar a coleta inteira, reenviar a mesma janela a
cada ciclo e — o mais caro de todos — consultar a Apple rápido demais e perder
a conta.
"""
import importlib
import os
import struct
from base64 import b64encode

import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.asymmetric import ec

import worker
from test_findmy_crypto import _monta_relatorio


def _tag(imei="92603008494"):
    priv = ec.generate_private_key(ec.SECP224R1(), default_backend())
    priv_b64 = b64encode(
        priv.private_numbers().private_value.to_bytes(28, "big")
    ).decode()
    return {
        "deviceImei": imei,
        "privateKey": priv_b64,
        "hashedAdvKey": f"hash-{imei}",
        "mode": "TURBO",
        "intervalSeconds": 1800,
        "backfillHours": 168,
    }, priv


class TestMontarPayloads:
    def test_decifra_e_monta_o_corpo_do_sighting(self):
        tag, priv = _tag()
        relatorio = _monta_relatorio(-22.9390364, -43.5600123, 42, 0, 1787760795, priv)

        saida = worker.montar_payloads(
            [{"id": tag["hashedAdvKey"], "payload": relatorio}], [tag]
        )

        assert len(saida) == 1
        p = saida[0]
        assert p["deviceImei"] == "92603008494"
        assert p["scannerLat"] == pytest.approx(-22.9390364, abs=1e-7)
        assert p["scannerLng"] == pytest.approx(-43.5600123, abs=1e-7)
        assert p["accuracy"] == 42
        assert p["scannerSource"] == "apple-findmy"
        assert p["seenAt"].startswith("2026-")

    def test_ignora_relatorio_de_chave_que_nao_pedimos(self):
        tag, priv = _tag()
        relatorio = _monta_relatorio(-22.9, -43.5, 10, 0, 1787760795, priv)

        saida = worker.montar_payloads(
            [{"id": "hash-de-outra-tag", "payload": relatorio}], [tag]
        )
        assert saida == []

    def test_relatorio_podre_nao_derruba_os_bons(self):
        tag_a, priv_a = _tag("111")
        tag_b, priv_b = _tag("222")
        bom = _monta_relatorio(-22.9, -43.5, 10, 0, 1787760795, priv_b)

        saida = worker.montar_payloads(
            [
                {"id": tag_a["hashedAdvKey"], "payload": b64encode(os.urandom(90)).decode()},
                {"id": tag_b["hashedAdvKey"], "payload": bom},
            ],
            [tag_a, tag_b],
        )

        assert len(saida) == 1
        assert saida[0]["deviceImei"] == "222"

    def test_tag_sem_chave_privada_e_ignorada(self):
        tag, priv = _tag()
        relatorio = _monta_relatorio(-22.9, -43.5, 10, 0, 1787760795, priv)
        tag_sem_chave = {**tag, "privateKey": None}

        saida = worker.montar_payloads(
            [{"id": tag["hashedAdvKey"], "payload": relatorio}], [tag_sem_chave]
        )
        assert saida == []


class TestDeduplicar:
    def test_remove_o_mesmo_avistamento_repetido(self):
        p = {
            "deviceImei": "1",
            "hashedAdvKey": "h",
            "seenAt": "2026-08-26T10:00:00+00:00",
        }
        assert len(worker.deduplicar([p, dict(p), dict(p)])) == 1

    def test_mantem_avistamentos_de_horarios_diferentes(self):
        base = {"deviceImei": "1", "hashedAdvKey": "h"}
        entrada = [
            {**base, "seenAt": "2026-08-26T10:00:00+00:00"},
            {**base, "seenAt": "2026-08-26T10:30:00+00:00"},
        ]
        assert len(worker.deduplicar(entrada)) == 2


class TestJanela:
    def test_usa_a_maior_janela_pedida(self):
        plano = [{"backfillHours": 24}, {"backfillHours": 168}]
        assert worker.janela_em_dias(plano) == 7

    def test_nunca_passa_dos_7_dias_que_a_apple_guarda(self):
        assert worker.janela_em_dias([{"backfillHours": 24 * 30}]) == 7

    def test_nunca_pede_menos_de_um_dia(self):
        assert worker.janela_em_dias([{"backfillHours": 1}]) == 1


class TestPisoDeSeguranca:
    """
    Consultar a Apple de 5 em 5 minutos bane a conta e leva junto a trilha de
    todas as TAGs. O worker recusa qualquer configuração abaixo de 30 min.
    """

    def test_configuracao_agressiva_e_ignorada(self, monkeypatch):
        monkeypatch.setenv("WORKER_INTERVAL_S", "60")
        recarregado = importlib.reload(worker)
        try:
            assert recarregado.INTERVALO_S == 1800
        finally:
            monkeypatch.delenv("WORKER_INTERVAL_S", raising=False)
            importlib.reload(worker)

    def test_intervalo_maior_e_respeitado(self, monkeypatch):
        monkeypatch.setenv("WORKER_INTERVAL_S", "3600")
        recarregado = importlib.reload(worker)
        try:
            assert recarregado.INTERVALO_S == 3600
        finally:
            monkeypatch.delenv("WORKER_INTERVAL_S", raising=False)
            importlib.reload(worker)


class TestCiclo:
    def test_plano_vazio_nao_bate_na_apple(self, monkeypatch):
        chamou = []
        monkeypatch.setattr(worker, "carregar_plano", lambda: [])
        monkeypatch.setattr(
            worker,
            "fetch_reports",
            lambda *a, **k: chamou.append(1) or [],
        )

        worker.ciclo()
        assert chamou == []

    def test_ciclo_completo_envia_o_que_decifrou(self, monkeypatch):
        tag, priv = _tag()
        relatorio = _monta_relatorio(-22.9, -43.5, 33, 0, 1787760795, priv)
        enviados = []

        monkeypatch.setattr(worker, "carregar_plano", lambda: [tag])
        monkeypatch.setattr(
            worker,
            "fetch_reports",
            lambda *a, **k: [{"id": tag["hashedAdvKey"], "payload": relatorio}],
        )
        monkeypatch.setattr(
            worker, "postar", lambda ps: (enviados.extend(ps), (len(ps), 0))[1]
        )

        worker.ciclo()

        assert len(enviados) == 1
        assert enviados[0]["accuracy"] == 33
