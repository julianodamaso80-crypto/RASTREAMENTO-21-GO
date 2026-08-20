"""
Memória curta do que já foi entregue ao backend.

A Apple devolve a mesma janela de relatórios a cada consulta, então sem isso
cada ciclo reenviaria tudo de novo. A identidade de um relatório é a TAG mais o
instante em que ela foi vista.
"""
from collections import OrderedDict


class Dedupe:
    def __init__(self, limite: int = 5000):
        self._limite = limite
        self._vistos: OrderedDict = OrderedDict()

    def _chave(self, payload: dict) -> str:
        return f"{payload['hashedAdvKey']}|{payload['seenAt']}"

    def ja_enviado(self, payload: dict) -> bool:
        return self._chave(payload) in self._vistos

    def marcar(self, payload: dict) -> None:
        chave = self._chave(payload)
        self._vistos[chave] = True
        self._vistos.move_to_end(chave)
        while len(self._vistos) > self._limite:
            self._vistos.popitem(last=False)

    def __len__(self) -> int:
        return len(self._vistos)
