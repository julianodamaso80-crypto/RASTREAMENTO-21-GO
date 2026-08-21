"""
Lembra, dentro do processo, quais TAGs já tiveram a janela de backfill baixada.

O plano manda `backfillHours` alto (até 7 dias, o limite de retenção da
Apple) só para justificar o primeiro ciclo depois que uma TAG entra em modo
acelerado. Sem controle nenhum, enquanto a TAG continuar acelerada o worker
pediria a semana inteira de novo a cada ciclo — pelo proxy residencial pago,
que é o recurso mais fácil de esgotar/bloquear neste desenho.

A decisão de QUANTO baixar (backfillHours) continua sendo do backend; este
módulo só decide "já baixei essa TAG, da próxima vez peço pouco".
"""


class RastreadorDeBackfill:
    def __init__(self, janela_curta_horas: int = 1):
        self._janela_curta_horas = janela_curta_horas
        self._ja_baixados: set[str] = set()

    def horas_para_o_ciclo(self, tags: list) -> int:
        """Janela única para a chamada em lote à Apple: o maior valor entre
        as TAGs do plano, mas trocando por uma janela curta quem já teve o
        backfill baixado enquanto seguir acelerada."""
        horas = []
        for tag in tags:
            pedido = tag.get("backfillHours", 0)
            chave = tag.get("hashedAdvKey")
            if pedido > 0 and chave in self._ja_baixados:
                horas.append(self._janela_curta_horas)
            else:
                horas.append(pedido)
        return max(horas) if horas else 0

    def atualizar(self, tags: list) -> None:
        """Chamar só depois de uma busca bem-sucedida na Apple. TAG que
        pediu backfill (>0h) entra para o controle — o próximo ciclo já usa
        janela curta. TAG que parou de pedir (saiu do modo acelerado) sai do
        controle, para reentrar elegível a um backfill completo de novo."""
        for tag in tags:
            chave = tag.get("hashedAdvKey")
            if tag.get("backfillHours", 0) > 0:
                self._ja_baixados.add(chave)
            else:
                self._ja_baixados.discard(chave)
