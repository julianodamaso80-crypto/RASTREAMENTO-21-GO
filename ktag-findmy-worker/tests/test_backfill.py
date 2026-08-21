"""
Testa RastreadorDeBackfill.atualizar isoladamente — em particular a regra
de que uma resposta vazia da Apple (o formato exato de um bloqueio de IP do
proxy: 200 OK, lista vazia, sem exceção nenhuma) não pode armar o backfill
como se a TAG já tivesse baixado a janela inteira. Ver findmy_worker/loop.py
e o cenário completo (ciclo a ciclo) em tests/test_loop.py.
"""
from findmy_worker.backfill import RastreadorDeBackfill

TAG_A = {"hashedAdvKey": "hash-a", "backfillHours": 168}
TAG_B = {"hashedAdvKey": "hash-b", "backfillHours": 168}


def test_resposta_vazia_nao_marca_a_tag_como_backfilled():
    """O caso do bloqueio de IP: apple.buscar devolveu lista vazia sem
    lançar exceção — chaves_com_relatorio fica vazio. Sem relatório nenhum
    pra essa chave, a TAG continua elegível ao backfill completo no
    próximo ciclo."""
    rastreador = RastreadorDeBackfill(janela_curta_horas=1)

    rastreador.atualizar([TAG_A], chaves_com_relatorio=set())

    assert rastreador.horas_para_o_ciclo([TAG_A]) == 168


def test_relatorio_de_verdade_marca_a_tag_como_backfilled():
    rastreador = RastreadorDeBackfill(janela_curta_horas=1)

    rastreador.atualizar([TAG_A], chaves_com_relatorio={"hash-a"})

    assert rastreador.horas_para_o_ciclo([TAG_A]) == 1


def test_marcacao_e_por_tag_nao_por_resposta_com_pelo_menos_um_relatorio():
    """Duas TAGs aceleradas no mesmo ciclo; a Apple só devolveu relatório
    para uma delas (a outra pode estar fora de área, ou pode ser o começo
    de um bloqueio parcial). Marcar as duas como backfilled só porque a
    resposta não veio 100% vazia repetiria o mesmo bug do bloqueio de IP
    pra quem não teve sorte de aparecer no lote."""
    rastreador = RastreadorDeBackfill(janela_curta_horas=1)

    rastreador.atualizar([TAG_A, TAG_B], chaves_com_relatorio={"hash-a"})

    assert rastreador.horas_para_o_ciclo([TAG_A]) == 1
    assert rastreador.horas_para_o_ciclo([TAG_B]) == 168


def test_tag_que_sai_do_modo_acelerado_sai_do_controle_mesmo_sem_relatorio():
    """backfillHours=0 é a TAG saindo do modo acelerado — isso sempre limpa
    o controle, com ou sem relatório no ciclo, para reentrar elegível a um
    backfill completo na próxima vez que acelerar."""
    rastreador = RastreadorDeBackfill(janela_curta_horas=1)
    rastreador.atualizar([TAG_A], chaves_com_relatorio={"hash-a"})
    assert rastreador.horas_para_o_ciclo([TAG_A]) == 1

    tag_a_normal = {**TAG_A, "backfillHours": 0}
    rastreador.atualizar([tag_a_normal], chaves_com_relatorio=set())

    tag_a_acelerada_de_novo = TAG_A
    assert rastreador.horas_para_o_ciclo([tag_a_acelerada_de_novo]) == 168
