"""
Distingue "ninguém viu a TAG" de "a Apple nos bloqueou".

A Apple responde 200 OK com lista vazia nos dois casos. Confundir os dois é
ficar meses achando que a TAG está fora de área quando na verdade o IP do
proxy foi barrado. Se ao menos uma TAG reportou na janela, o silêncio das
outras é normal e nada é alarmado.

Um bloqueio de IP permanente não pode virar um único log.error perdido lá na
hora seis, num container que ninguém está olhando — por isso o alarme se
rearma: se o silêncio continuar por mais uma janela inteira depois do
primeiro aviso, ele dispara de novo.
"""
from datetime import datetime, timedelta


class DetectorDeSilencio:
    def __init__(self, janela_horas: float = 6.0):
        self._janela = timedelta(hours=janela_horas)
        self._ultimo_relatorio: datetime | None = None
        self._ultimo_alarme: datetime | None = None

    def registrar_ciclo(self, houve_relatorio: bool, agora: datetime) -> bool:
        if houve_relatorio:
            self._ultimo_relatorio = agora
            self._ultimo_alarme = None
            return False

        if self._ultimo_relatorio is None:
            self._ultimo_relatorio = agora
            return False

        if agora - self._ultimo_relatorio <= self._janela:
            return False

        if self._ultimo_alarme is not None and agora - self._ultimo_alarme <= self._janela:
            return False

        self._ultimo_alarme = agora
        return True
