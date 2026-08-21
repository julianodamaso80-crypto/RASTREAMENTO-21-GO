from datetime import datetime, timezone

import pytest

from findmy_worker.apple_errors import ErroDeAutenticacaoApple
from findmy_worker.backend_client import ErroDeCredencial, ErroPermanente, ErroTransitorio
from findmy_worker.backfill import RastreadorDeBackfill
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
    def __init__(self, falha_ao_enviar=False, rejeita=None):
        """`rejeita` é um predicado opcional payload -> bool: quando dá True
        para um payload, simula o backend recusando aquele conteúdo em
        definitivo (ErroPermanente) em vez de estar fora do ar."""
        self.enviados = []
        self.falha_ao_enviar = falha_ao_enviar
        self.rejeita = rejeita

    def plano(self):
        return PLANO

    def enviar(self, payload):
        if self.rejeita is not None and self.rejeita(payload):
            raise ErroPermanente("backend rejeitou o conteúdo do payload")
        if self.falha_ao_enviar:
            raise ErroTransitorio("backend fora")
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


def test_item_envenenado_na_fila_vai_para_quarentena_sem_travar_o_resto(tmp_path):
    """Um payload que o backend rejeita em definitivo (ErroPermanente) não
    pode bloquear os itens atrás dele na fila — a varredura precisa seguir
    e entregar o resto."""
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "venenoso"})
    caixa.guardar({"deviceImei": "bom"})

    backend = BackendFalso(rejeita=lambda p: p.get("deviceImei") == "venenoso")

    executar_ciclo(backend, AppleFalsa([]), Dedupe(), caixa, DetectorDeSilencio(), AGORA)

    assert [p["deviceImei"] for p in backend.enviados] == ["bom"]
    assert caixa.pendentes() == []
    corrompidos = list((tmp_path / "corrompidos").glob("*.json"))
    assert len(corrompidos) == 1


def test_falha_transitoria_ao_drenar_mantem_a_fila_intacta(tmp_path):
    """Backend fora do ar (ErroTransitorio) não é motivo pra perder nem
    quarentenar nada — os itens continuam na fila pro próximo ciclo."""
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1"})
    caixa.guardar({"deviceImei": "2"})

    backend = BackendFalso(falha_ao_enviar=True)

    executar_ciclo(backend, AppleFalsa([]), Dedupe(), caixa, DetectorDeSilencio(), AGORA)

    assert backend.enviados == []
    assert len(caixa.pendentes()) == 2
    pasta_corrompidos = tmp_path / "corrompidos"
    assert not pasta_corrompidos.exists() or list(pasta_corrompidos.glob("*")) == []


def test_resultado_do_ciclo_reporta_o_tamanho_do_backlog(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1"})

    backend = BackendFalso(falha_ao_enviar=True)

    r = executar_ciclo(backend, AppleFalsa([]), Dedupe(), caixa, DetectorDeSilencio(), AGORA)

    assert r["pendentes"] == 1


def test_credencial_expirada_ao_enviar_propaga_em_vez_de_virar_fila(tmp_path):
    """Token JWT de staff expira em 12h (ver README) — precisa ser
    distinguível de falha comum de rede/conteúdo, senão o item vira só mais
    um "enfileirado" e o ciclo seguinte cai no genérico e ninguém percebe
    que o worker está cego."""
    class BackendCredencialMorta:
        def plano(self):
            return PLANO

        def enviar(self, payload):
            raise ErroDeCredencial("token expirado")

    with pytest.raises(ErroDeCredencial):
        executar_ciclo(
            BackendCredencialMorta(), AppleFalsa([um_relatorio()]), Dedupe(),
            Outbox(tmp_path), DetectorDeSilencio(), AGORA,
        )


def test_credencial_expirada_ao_drenar_a_fila_tambem_propaga(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1"})

    class BackendCredencialMorta:
        def plano(self):
            return PLANO

        def enviar(self, payload):
            raise ErroDeCredencial("token expirado")

    with pytest.raises(ErroDeCredencial):
        executar_ciclo(
            BackendCredencialMorta(), AppleFalsa([]), Dedupe(), caixa,
            DetectorDeSilencio(), AGORA,
        )


def test_segundo_ciclo_acelerado_usa_janela_curta_em_vez_de_sete_dias(tmp_path):
    """O plano manda 168h (7 dias, o limite de retenção da Apple) pra
    justificar o primeiro ciclo depois que a TAG acelera. Repetir isso a
    cada minuto enquanto ela seguir acelerada é o jeito mais rápido de
    estourar o proxy residencial pago — mas só quando o primeiro ciclo
    realmente trouxe relatório de volta (ver
    test_bloqueio_de_ip_com_lista_vazia_nao_esvazia_o_backfill logo abaixo
    para o caso em que não trouxe)."""
    apple = AppleFalsa([um_relatorio()])
    rastreador = RastreadorDeBackfill(janela_curta_horas=1)
    backend = BackendFalso()
    dedupe, caixa, det = Dedupe(), Outbox(tmp_path), DetectorDeSilencio()

    executar_ciclo(backend, apple, dedupe, caixa, det, AGORA, rastreador)
    executar_ciclo(backend, apple, dedupe, caixa, det, AGORA, rastreador)

    assert apple.pedidos[0][1] == 168
    assert apple.pedidos[1][1] == 1


def test_bloqueio_de_ip_com_lista_vazia_nao_esvazia_o_backfill(tmp_path):
    """Cenário do veículo roubado: TAG entra em modo acelerado (168h) no
    mesmo ciclo em que o proxy residencial está bloqueado pela Apple —
    bloqueio de IP responde 200 OK com lista vazia, indistinguível de
    "nenhuma TAG foi vista" (apple.buscar não lança nada). Se isso marcasse
    a TAG como já backfilled, o bloqueio passar 20 minutos depois faria
    todo ciclo seguinte pedir só 1h, e o rastro de 7 dias que a Apple ainda
    guarda da semana do roubo nunca mais seria pedido de novo."""
    apple = AppleFalsa([])  # bloqueio de IP: sem exceção, sem relatório
    rastreador = RastreadorDeBackfill(janela_curta_horas=1)
    backend = BackendFalso()
    dedupe, caixa, det = Dedupe(), Outbox(tmp_path), DetectorDeSilencio()

    executar_ciclo(backend, apple, dedupe, caixa, det, AGORA, rastreador)
    executar_ciclo(backend, apple, dedupe, caixa, det, AGORA, rastreador)

    assert apple.pedidos[0][1] == 168
    assert apple.pedidos[1][1] == 168


def test_tag_que_sai_do_modo_acelerado_e_reentra_ganha_backfill_novo(tmp_path):
    apple = AppleFalsa([])
    rastreador = RastreadorDeBackfill(janela_curta_horas=1)
    dedupe, caixa, det = Dedupe(), Outbox(tmp_path), DetectorDeSilencio()

    executar_ciclo(BackendFalso(), apple, dedupe, caixa, det, AGORA, rastreador)

    plano_normal = {
        "tags": [{**PLANO["tags"][0], "backfillHours": 0, "intervalSeconds": 3600}]
    }

    class BackendNormal:
        def plano(self):
            return plano_normal

        def enviar(self, payload):
            pass

    executar_ciclo(BackendNormal(), apple, dedupe, caixa, det, AGORA, rastreador)
    executar_ciclo(BackendFalso(), apple, dedupe, caixa, det, AGORA, rastreador)

    assert [pedido[1] for pedido in apple.pedidos] == [168, 0, 168]


def test_relatorio_sem_tag_correspondente_e_contado_em_vez_de_sumir(tmp_path, caplog):
    """As chaves são cadastradas à mão (Device.bleAdvKeyHashed) — uma
    divergência de encoding derruba 100% dos relatórios e o ciclo reporta
    "enviados: 0", indistinguível de "nenhuma TAG foi vista"."""
    relatorio_orfao = um_relatorio()
    relatorio_orfao["hashed_adv_key"] = "chave-sem-tag-no-plano"

    with caplog.at_level("WARNING"):
        r = executar_ciclo(
            BackendFalso(), AppleFalsa([relatorio_orfao]), Dedupe(),
            Outbox(tmp_path), DetectorDeSilencio(), AGORA,
        )

    assert r["nao_correspondidos"] == 1
    assert r["enviados"] == 0
    aviso = next(rec for rec in caplog.records if "sem TAG correspondente" in rec.message)
    assert "chave-sem-tag-no-plano" in aviso.message


def test_plano_vazio_nao_alimenta_o_detector_de_silencio(tmp_path):
    """Plano vazio é "ninguém cadastrou chave ainda", não silêncio nem
    avistamento — alimentar o detector aqui faria ele alarmar bloqueio de
    IP num ambiente que nunca teve nada pra achar."""
    class DetectorEspiao(DetectorDeSilencio):
        def __init__(self):
            super().__init__()
            self.chamadas = []

        def registrar_ciclo(self, houve, agora):
            self.chamadas.append(houve)
            return super().registrar_ciclo(houve, agora)

    class BackendSemTags:
        def plano(self):
            return {"tags": []}

        def enviar(self, payload):
            pass

    det = DetectorEspiao()
    r = executar_ciclo(BackendSemTags(), AppleFalsa([]), Dedupe(), Outbox(tmp_path), det, AGORA)

    assert det.chamadas == []
    assert r["silencio_suspeito"] is False


def test_falha_de_autenticacao_na_apple_para_de_consultar_e_nao_alarma_silencio(tmp_path):
    class AppleComSessaoMorta:
        def __init__(self):
            self.pedidos = 0

        def buscar(self, tags, backfill_horas):
            self.pedidos += 1
            raise ErroDeAutenticacaoApple("sessao expirada")

    apple = AppleComSessaoMorta()

    class DetectorEspiao(DetectorDeSilencio):
        def __init__(self):
            super().__init__()
            self.chamadas = []

        def registrar_ciclo(self, houve, agora):
            self.chamadas.append(houve)
            return super().registrar_ciclo(houve, agora)

    det = DetectorEspiao()
    r = executar_ciclo(BackendFalso(), apple, Dedupe(), Outbox(tmp_path), det, AGORA)

    assert r["apple_autenticado"] is False
    assert det.chamadas == []
    assert apple.pedidos == 1


def test_resultado_do_ciclo_reporta_o_tamanho_da_quarentena(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "venenoso"})

    backend = BackendFalso(rejeita=lambda p: p.get("deviceImei") == "venenoso")

    r = executar_ciclo(backend, AppleFalsa([]), Dedupe(), caixa, DetectorDeSilencio(), AGORA)

    assert r["quarentena"] == 1
