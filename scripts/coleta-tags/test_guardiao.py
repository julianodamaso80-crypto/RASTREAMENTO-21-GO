import unittest
from datetime import datetime, timedelta

import guardiao as g

AGORA = datetime(2026, 9, 17, 10, 0, 0)  # UTC

LOG_BOM = """[2026-09-17 08:17:01] inicio — 500 chaves
chaves carregadas: 500
sessao ok: juliano.damaso@icloud.com
AVISTAMENTOS: 3700
[2026-09-17 08:17:08] fim — 3700 avistamentos lidos, 900 novos gravados
[2026-09-17 09:17:01] inicio — 500 chaves
AVISTAMENTOS: 3690
[2026-09-17 09:17:08] fim — 3690 avistamentos lidos, 850 novos gravados
"""

LOG_503 = """[2026-09-17 09:17:01] inicio — 500 chaves
sessao ok: juliano.damaso@icloud.com
ERRO no lote 1: Error response for GSA request: 503
AVISTAMENTOS: 0
[2026-09-17 09:17:03] nenhum avistamento novo neste ciclo
"""

MOTOR_BOM = """[2026-09-17 09:23:01] inicio
[2026-09-17T09:23:02.5+00:00] decifrados: 8 avistamento(s)
[2026-09-17 09:23:03] fim
"""


class UltimoCiclo(unittest.TestCase):
    def test_pega_o_ultimo_bloco(self):
        quando, bloco = g.ultimo_ciclo(LOG_BOM)
        self.assertEqual(quando, datetime(2026, 9, 17, 9, 17, 1))
        self.assertIn("3690", bloco)
        self.assertNotIn("3700", bloco)

    def test_log_sem_inicio(self):
        self.assertEqual(g.ultimo_ciclo("nada aqui"), (None, ""))


class Coleta(unittest.TestCase):
    def test_tudo_certo(self):
        self.assertEqual(g.checar_coleta(LOG_BOM, AGORA, parado=False), [])

    def test_erro_503(self):
        falhas = g.checar_coleta(LOG_503, AGORA, parado=False)
        self.assertEqual(len(falhas), 1)
        self.assertIn("503", falhas[0])

    def test_zero_avistamentos_sem_erro(self):
        log = "[2026-09-17 09:17:01] inicio — 500 chaves\nAVISTAMENTOS: 0\n"
        self.assertEqual(len(g.checar_coleta(log, AGORA, parado=False)), 1)

    def test_parado(self):
        falhas = g.checar_coleta(LOG_BOM, AGORA, parado=True)
        self.assertTrue(any("PARADO" in f for f in falhas))

    def test_ciclo_velho(self):
        velho = AGORA + timedelta(hours=2, minutes=1)
        falhas = g.checar_coleta(LOG_BOM, velho, parado=False)
        self.assertTrue(any("não roda" in f for f in falhas))

    def test_exatamente_2h_ainda_ok(self):
        limite = datetime(2026, 9, 17, 11, 17, 1)
        self.assertEqual(g.checar_coleta(LOG_BOM, limite, parado=False), [])

    def test_log_vazio(self):
        self.assertEqual(len(g.checar_coleta("", AGORA, parado=False)), 1)


class Motor(unittest.TestCase):
    def test_tudo_certo(self):
        self.assertEqual(g.checar_motor(MOTOR_BOM, AGORA, parado=False), [])

    def test_erro(self):
        log = "[2026-09-17 09:23:01] inicio\nERRO no lote 1: Error response for GSA request: 503\n"
        self.assertEqual(len(g.checar_motor(log, AGORA, parado=False)), 1)

    def test_parado(self):
        self.assertTrue(g.checar_motor(MOTOR_BOM, AGORA, parado=True))


class Demais(unittest.TestCase):
    def test_posicoes(self):
        self.assertEqual(g.checar_posicoes(10), [])
        self.assertEqual(len(g.checar_posicoes(0)), 1)

    def test_anisette(self):
        self.assertEqual(g.checar_anisette(True, g.MD5_ADI_ESPERADO), [])
        self.assertEqual(len(g.checar_anisette(False, None)), 1)
        self.assertEqual(len(g.checar_anisette(True, "outro")), 1)

    def test_apple(self):
        self.assertEqual(g.checar_apple("401"), [])
        self.assertEqual(len(g.checar_apple("503")), 1)
        self.assertEqual(len(g.checar_apple("000")), 1)

    def test_recursos(self):
        self.assertEqual(g.checar_recursos(69.9, 50), [])
        self.assertEqual(len(g.checar_recursos(70.0, 50)), 1)
        self.assertEqual(len(g.checar_recursos(10, 71)), 1)


class Mensagem(unittest.TestCase):
    def test_sem_falha_nao_manda(self):
        self.assertIsNone(g.montar_mensagem([], AGORA))

    def test_com_falha(self):
        texto = g.montar_mensagem(["a", "b"], AGORA)
        self.assertIn("07:00", texto)  # horário de Brasília
        self.assertIn("• a", texto)
        self.assertIn("• b", texto)


class Avaliar(unittest.TestCase):
    FATOS_OK = dict(
        log_coleta=LOG_BOM, parado_coleta=False,
        log_motor=MOTOR_BOM, parado_motor=False,
        posicoes_2h=500, anisette_rodando=True,
        anisette_md5=g.MD5_ADI_ESPERADO, apple_http="401",
        disco_pct=51.0, mem_pct=46.0,
    )

    def test_tudo_certo_sem_falha(self):
        self.assertEqual(g.avaliar(self.FATOS_OK, AGORA), [])

    def test_junta_falhas_de_fontes_diferentes(self):
        fatos = dict(self.FATOS_OK, apple_http="503", disco_pct=80.0, log_coleta=LOG_503)
        self.assertEqual(len(g.avaliar(fatos, AGORA)), 3)

    def test_fato_que_nao_pode_ser_lido_vira_falha(self):
        fatos = dict(self.FATOS_OK, posicoes_2h=None)
        falhas = g.avaliar(fatos, AGORA)
        self.assertTrue(any("não consegui ler" in f for f in falhas))

if __name__ == "__main__":
    unittest.main()
