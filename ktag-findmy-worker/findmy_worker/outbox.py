"""
Fila em disco para quando o backend do 21 GO está fora do ar.

Relatório da rede Find My tem validade: a Apple guarda 7 dias, mas o que já
baixamos e não entregamos se perde na memória do processo. Gravar em arquivo é
o que garante que uma indisponibilidade nossa não apague posição de veículo
roubado.
"""
import json
import uuid
from pathlib import Path


class Outbox:
    def __init__(self, pasta: Path):
        self._pasta = Path(pasta)
        self._pasta.mkdir(parents=True, exist_ok=True)

    def guardar(self, payload: dict) -> Path:
        caminho = self._pasta / f"{uuid.uuid4().hex}.json"
        caminho.write_text(json.dumps(payload), encoding="utf-8")
        return caminho

    def pendentes(self) -> list:
        itens = []
        for caminho in sorted(self._pasta.glob("*.json")):
            try:
                itens.append((caminho, json.loads(caminho.read_text(encoding="utf-8"))))
            except json.JSONDecodeError:
                caminho.unlink(missing_ok=True)
        return itens

    def remover(self, caminho: Path) -> None:
        Path(caminho).unlink(missing_ok=True)
