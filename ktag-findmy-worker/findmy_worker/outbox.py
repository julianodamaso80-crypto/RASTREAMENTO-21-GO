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
        self._varrer_tmp_orfaos()

    def _varrer_tmp_orfaos(self) -> None:
        """O worker cria seu Outbox no boot. Qualquer .tmp presente nesse
        momento só pode ser resto de um write_text/os.replace interrompido
        por um processo que já morreu (ex.: OOM kill) — não há relógio nem
        TTL envolvido, a própria existência do arquivo já prova isso."""
        for tmp in self._pasta.glob("*.tmp"):
            self._colocar_em_quarentena(tmp, "escrita interrompida por queda do processo")

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
            except (json.JSONDecodeError, UnicodeDecodeError) as erro:
                self._colocar_em_quarentena(caminho, str(erro))
        return itens

    def quarentenados(self) -> list:
        """Quantos payloads estão em quarentena agora. Diferente de
        `pendentes()`, não filtra por sufixo: um .tmp órfão também vai para
        cá (ver `_varrer_tmp_orfaos`), e contar só *.json subestimaria o
        tamanho real da quarentena."""
        self._pasta_corrompidos.mkdir(parents=True, exist_ok=True)
        return sorted(p for p in self._pasta_corrompidos.iterdir() if p.is_file())

    def quarentenar(self, caminho: Path, motivo: str) -> None:
        """Move um payload da fila para corrompidos/ quando o backend rejeita
        o conteúdo em definitivo (ErroPermanente) — sem isso o item ficaria
        tentando de novo pra sempre e travando tudo atrás dele."""
        self._colocar_em_quarentena(Path(caminho), motivo)

    def _colocar_em_quarentena(self, caminho: Path, motivo: str) -> None:
        logger.warning("relatório corrompido movido para quarentena (%s): %s", motivo, caminho)
        self._pasta_corrompidos.mkdir(parents=True, exist_ok=True)
        os.replace(caminho, self._pasta_corrompidos / caminho.name)

    def remover(self, caminho: Path) -> None:
        Path(caminho).unlink(missing_ok=True)
