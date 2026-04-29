#!/usr/bin/env bash
#
# retention-tc-positions.sh — apaga posições Traccar antigas (>90 dias).
#
# A tabela `tc_positions` cresce 28.8M registros/dia em 20k ativos.
# Sem retention, disco satura em ~3 meses. Manter 90 dias é suficiente para
# relatórios e histórico operacional; backups guardam o resto.
#
# Roda em batch de 100k linhas pra não travar VACUUM nem locks longos.
#
# Instalar como cron semanal — domingo 04:00 BRT:
#   0 4 * * 0 /root/scripts/retention-tc-positions.sh >> /var/log/retention-r21go.log 2>&1
#
# Para rodar dry-run (só conta), `RETENTION_DRYRUN=1 ./retention-tc-positions.sh`.

set -euo pipefail

PG_CONTAINER=$(docker ps -q -f name=rastreamento-21-go_postgres-rastreamento || true)
DAYS=${RETENTION_DAYS:-90}
BATCH=${RETENTION_BATCH:-100000}
DRYRUN=${RETENTION_DRYRUN:-0}

if [ -z "$PG_CONTAINER" ]; then
  echo "[$(date)] ERRO: container postgres não encontrado"
  exit 1
fi

# Conta quantas linhas seriam apagadas
TO_DELETE=$(docker exec "$PG_CONTAINER" psql -U postgres -d traccar -t -A -c \
  "SELECT count(*) FROM tc_positions WHERE servertime < NOW() - INTERVAL '${DAYS} days';" \
  | tr -d ' ')

echo "[$(date)] Posições a apagar (>${DAYS}d): $TO_DELETE"

if [ "$TO_DELETE" -eq 0 ]; then
  echo "[$(date)] Nada a fazer"
  exit 0
fi

if [ "$DRYRUN" = "1" ]; then
  echo "[$(date)] DRYRUN — nenhuma linha apagada"
  exit 0
fi

# DELETE em batch — evita lock longo.
TOTAL=0
while [ "$TOTAL" -lt "$TO_DELETE" ]; do
  BATCH_DELETED=$(docker exec "$PG_CONTAINER" psql -U postgres -d traccar -t -A -c \
    "WITH old AS (
       SELECT id FROM tc_positions
       WHERE servertime < NOW() - INTERVAL '${DAYS} days'
       ORDER BY servertime
       LIMIT ${BATCH}
     )
     DELETE FROM tc_positions WHERE id IN (SELECT id FROM old)
     RETURNING 1;" | grep -c '^1$' || true)

  if [ "$BATCH_DELETED" -eq 0 ]; then
    break
  fi
  TOTAL=$((TOTAL + BATCH_DELETED))
  echo "[$(date)] Apagadas $TOTAL / $TO_DELETE"
  sleep 2  # respira pra não saturar o pool
done

# VACUUM ANALYZE pra liberar espaço e atualizar planner
echo "[$(date)] VACUUM ANALYZE tc_positions..."
docker exec "$PG_CONTAINER" psql -U postgres -d traccar -c \
  "VACUUM ANALYZE tc_positions;" 2>&1 | tail -3

echo "[$(date)] Retention completa: $TOTAL linhas removidas"
