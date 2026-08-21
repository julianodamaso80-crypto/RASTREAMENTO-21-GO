"""
Fila em disco para quando o backend do 21 GO está fora do ar.

Relatório da rede Find My tem validade: a Apple guarda 7 dias, mas o que já
baixamos e não entregamos se perde na memória do processo. Gravar em arquivo é
o que garante que uma indisponibilidade nossa não apague posição de veículo
roubado.
"""
import json
import logging
import os
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)


class Outbox:
    def __init__(self, pasta: Path):
        self._pasta = Path(pasta)
        self._pasta.mkdir(parents=True, exist_ok=True)
        self._pasta_corrompidos = self._pasta / "corrompidos"

    def guardar(self, payload: dict) -> Path:
        caminho = self._pasta / f"{uuid.uuid4().hex}.json"
        temporario = caminho.with_suffix(".tmp")
        temporario.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(temporario, caminho)
        return caminho

    def pendentes(self) -> list:
        itens = []
        for caminho in sorted(self._pasta.glob("*.json")):
            try:
                itens.append((caminho, json.loads(caminho.read_text(encoding="utf-8"))))
            except json.JSONDecodeError:
                self._colocar_em_quarentena(caminho)
        return itens

    def _colocar_em_quarentena(self, caminho: Path) -> None:
        logger.warning("relatório corrompido movido para quarentena: %s", caminho)
        self._pasta_corrompidos.mkdir(parents=True, exist_ok=True)
        os.replace(caminho, self._pasta_corrompidos / caminho.name)

    def remover(self, caminho: Path) -> None:
        Path(caminho).unlink(missing_ok=True)
