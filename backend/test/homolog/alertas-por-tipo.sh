#!/usr/bin/env bash
# Confere o cron de alertas (@Interval 60 s) num boot da homologação efêmera.
#
# Uso: alertas-por-tipo.sh <modo> <log-do-backend> <epoch-do-boot> [episodio]
# Env: DATABASE_URL (Postgres do runner).
#
# Espera até 70 s depois do boot (o primeiro tique sai aos 60 s), imprime a
# contagem de alertas por tipo e procura erro do cron no log. Com "episodio"
# (boot com ALERTS_DEDUP_EPISODIO=OFFLINE e LOG_LEVEL=debug), exige a linha
# de debug "suprimidosPorEpisodio", nenhum erro do cron e nenhum 5xx no log.
# Contagem de alertas é só impressa, nunca reprova.
set -uo pipefail

modo=$1
log=$2
boot=$3
episodio=${4:-}

falta=$(( boot + 70 - $(date +%s) ))
if [ "$falta" -gt 0 ]; then
  echo "Esperando ${falta} s para o cron de alertas rodar ao menos uma vez"
  sleep "$falta"
fi

echo "Alertas por tipo ($modo):"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT type, count(*) AS total, count(*) FILTER (WHERE deleted_at IS NULL) AS vivos FROM alerts GROUP BY type ORDER BY type" \
  || { echo "::error::consulta de alertas falhou ($modo)"; exit 1; }

rc=0
erros_cron=$(grep -c 'Erro inesperado em detect' "$log" || true)
echo "Erros do cron de alertas no log ($modo): $erros_cron"
episodios=$(grep -c 'suprimidosPorEpisodio' "$log" || true)
echo "Linhas de dedup por episódio no log ($modo): $episodios"
grep 'suprimidosPorEpisodio' "$log" | tail -3 || true

if [ -n "$episodio" ]; then
  if [ "$erros_cron" != "0" ]; then
    echo "::error::cron de alertas registrou erro no boot $modo"
    grep 'Erro inesperado em detect' "$log" | tail -5
    rc=1
  fi
  if [ "$episodios" = "0" ]; then
    echo "::error::boot $modo sem a linha de dedup por episódio: o caminho com a consulta crua não rodou"
    rc=1
  fi
  cincoxx=$(grep -c '"statusCode":5[0-9][0-9]' "$log" || true)
  echo "Respostas 5xx no log ($modo): $cincoxx"
  if [ "$cincoxx" != "0" ]; then
    echo "::error::boot $modo respondeu 5xx"
    grep '"statusCode":5[0-9][0-9]' "$log" | tail -5
    rc=1
  fi
  ofline=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM alerts WHERE type = 'OFFLINE'" || echo '?')
  [ "$ofline" = "0" ] && echo "::warning::boot $modo sem alerta OFFLINE: a consulta crua do último alerta pode não ter tido candidato"
fi
exit $rc
