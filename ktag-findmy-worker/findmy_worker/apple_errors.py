"""
Erro de autenticação da Apple, isolado do resto de findmy_worker.apple_client.

Este módulo não importa `findmy` nem `findmy_worker.apple_client` de
propósito: findmy_worker.loop precisa reconhecer esse erro para parar de
alimentar o detector de silêncio com um falso "ninguém viu a TAG", mas
loop.py (e os testes de loop.py) não podem depender da lib `findmy` — ela
nem sempre está instalada (ver requirements.txt / README).
"""


class ErroDeAutenticacaoApple(Exception):
    """A sessão da Apple expirou ou foi revogada (ex.: UnauthorizedError do
    FindMy.py, HTTP 401 na consulta de relatórios).

    O login automático está desligado de propósito — o 2FA por SMS da Apple
    está quebrado no momento, então reautenticar sozinho não é uma opção;
    é preciso rodar o login manual de novo com --trusteddevice. Até lá, o
    worker para de consultar a Apple (evita gastar o proxy pago repetindo
    uma chamada que já sabe que vai falhar) e sinaliza o estado no
    resultado do ciclo, para main.py alarmar sem parar o processo."""
