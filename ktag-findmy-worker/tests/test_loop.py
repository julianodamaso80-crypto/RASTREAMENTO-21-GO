from datetime import datetime, timezone

from findmy_worker.dedupe import Dedupe
from findmy_worker.loop import executar_ciclo
from findmy_worker.outbox import Outbox
from findmy_worker.silence import DetectorDeSilencio

AGORA = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)

PLANO = {
    "tags": [
        {
            "deviceImei": "92603008494",
            "privateKey": "priv",
            "hashedAdvKey": "hash",
            "mode": "TURBO",
            "intervalSeconds": 60,
            "backfillHours": 168,
        }
    ]
}


def um_relatorio(minuto=0):
    return {
        "latitude": -22.9,
        "longitude": -43.1,
        "horizontal_accuracy": 30,
        "timestamp": datetime(2026, 8, 20, 11, minuto, tzinfo=timezone.utc),
        "hashed_adv_key": "hash",
    }


class BackendFalso:
    def __init__(self, falha_ao_enviar=False):
        self.enviados = []
        self.falha_ao_enviar = falha_ao_enviar

    def plano(self):
        return PLANO

    def enviar(self, payload):
        if self.falha_ao_enviar:
            raise ConnectionError("backend fora")
        self.enviados.append(payload)


class AppleFalsa:
    def __init__(self, relatorios):
        self.relatorios = relatorios
        self.pedidos = []

    def buscar(self, tags, backfill_horas):
        self.pedidos.append((tags, backfill_horas))
        return self.relatorios


def test_relatorio_novo_chega_ao_backend(tmp_path):
    backend = BackendFalso()
    r = executar_ciclo(
        backend, AppleFalsa([um_relatorio()]), Dedupe(),
        Outbox(tmp_path), DetectorDeSilencio(), AGORA,
    )

    assert r["enviados"] == 1
    assert backend.enviados[0]["deviceImei"] == "92603008494"
    assert backend.enviados[0]["scannerSource"] == "apple-findmy"


def test_o_mesmo_relatorio_no_ciclo_seguinte_nao_e_reenviado(tmp_path):
    backend = BackendFalso()
    dedupe, caixa, det = Dedupe(), Outbox(tmp_path), DetectorDeSilencio()
    apple = AppleFalsa([um_relatorio()])

    executar_ciclo(backend, apple, dedupe, caixa, det, AGORA)
    r = executar_ciclo(backend, apple, dedupe, caixa, det, AGORA)

    assert r["enviados"] == 0
    assert len(backend.enviados) == 1


def test_backend_fora_do_ar_guarda_na_fila_em_vez_de_perder(tmp_path):
    caixa = Outbox(tmp_path)
    r = executar_ciclo(
        BackendFalso(falha_ao_enviar=True), AppleFalsa([um_relatorio()]),
        Dedupe(), caixa, DetectorDeSilencio(), AGORA,
    )

    assert r["enfileirados"] == 1
    assert len(caixa.pendentes()) == 1


def test_fila_e_drenada_quando_o_backend_volta(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "92603008494", "seenAt": "x"})
    backend = BackendFalso()

    executar_ciclo(backend, AppleFalsa([]), Dedupe(), caixa, DetectorDeSilencio(), AGORA)

    assert len(backend.enviados) == 1
    assert caixa.pendentes() == []


def test_pede_o_historico_de_sete_dias_quando_a_tag_esta_em_turbo(tmp_path):
    apple = AppleFalsa([])
    executar_ciclo(
        BackendFalso(), apple, Dedupe(), Outbox(tmp_path),
        DetectorDeSilencio(), AGORA,
    )

    assert apple.pedidos[0][1] == 168


def test_ciclo_sem_relatorio_nenhum_avisa_o_detector(tmp_path):
    class DetectorEspiao(DetectorDeSilencio):
        def __init__(self):
            super().__init__()
            self.chamadas = []

        def registrar_ciclo(self, houve, agora):
            self.chamadas.append(houve)
            return False

    det = DetectorEspiao()
    executar_ciclo(BackendFalso(), AppleFalsa([]), Dedupe(), Outbox(tmp_path), det, AGORA)

    assert det.chamadas == [False]
