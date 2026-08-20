"""
Distingue "ninguém viu a TAG" de "a Apple nos bloqueou".

A Apple responde 200 OK com lista vazia nos dois casos. Confundir os dois é
ficar meses achando que a TAG está fora de área quando na verdade o IP do
proxy foi barrado. Se ao menos uma TAG reportou na janela, o silêncio das
outras é normal e nada é alarmado.
"""
from datetime import datetime, timedelta


class DetectorDeSilencio:
    def __init__(self, janela_horas: float = 6.0):
        self._janela = timedelta(hours=janela_horas)
        self._ultimo_relatorio: datetime | None = None
        self._ja_alarmou = False

    def registrar_ciclo(self, houve_relatorio: bool, agora: datetime) -> bool:
        if houve_relatorio:
            self._ultimo_relatorio = agora
            self._ja_alarmou = False
            return False

        if self._ultimo_relatorio is None:
            self._ultimo_relatorio = agora
            return False

        if self._ja_alarmou:
            return False

        if agora - self._ultimo_relatorio > self._janela:
            self._ja_alarmou = True
            return True

        return False
