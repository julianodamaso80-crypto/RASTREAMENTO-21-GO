#!/usr/bin/env bash
#
# backup-r21go.sh — backup diário dos dois databases do projeto.
#
# Faz pg_dump de `rastreamento21go` (nosso) e `traccar` em arquivos gzip,
# guarda localmente em /root/backups/r21go/ com retention 30 dias.
#
# Para enviar pra DigitalOcean Spaces (recomendado em prod), descomente
# a seção "Spaces upload" no fim e configure as variáveis de ambiente.
#
# Instalar como cron diário 03:00 BRT:
#   crontab -e
#   0 3 * * * /root/scripts/backup-r21go.sh >> /var/log/backup-r21go.log 2>&1
#
# Restore manual:
#   gunzip -c /root/backups/r21go/rastreamento21go-2026-04-29.sql.gz | \
#     docker exec -i $(docker ps -q -f name=postgres-rastreamento) \
#     psql -U postgres -d rastreamento21go

set -euo pipefail

BACKUP_DIR="/root/backups/r21go"
RETENTION_DAYS=30
DATE=$(date +%Y-%m-%d-%H%M)
PG_CONTAINER=$(docker ps -q -f name=rastreamento-21-go_postgres-rastreamento || true)

if [ -z "$PG_CONTAINER" ]; then
  echo "[$(date)] ERRO: container postgres rastreamento não encontrado"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

dump_db() {
  local db="$1"
  local out="$BACKUP_DIR/${db}-${DATE}.sql.gz"
  echo "[$(date)] Backup $db -> $out"
  docker exec "$PG_CONTAINER" pg_dump -U postgres -d "$db" --clean --if-exists \
    | gzip > "$out"
  local size
  size=$(du -h "$out" | cut -f1)
  echo "[$(date)] OK $db ($size)"
}

dump_db "rastreamento21go"
dump_db "traccar"

# Retention: apaga backups com mais de N dias
find "$BACKUP_DIR" -name "*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete
echo "[$(date)] Retention executada (>${RETENTION_DAYS}d removidos)"

# ─────────────────────────────────────────────────────────────────────
# Upload pra DigitalOcean Spaces (opcional — descomentar quando configurar)
# Requer aws-cli + variáveis: SPACES_KEY, SPACES_SECRET, SPACES_BUCKET, SPACES_REGION
# ─────────────────────────────────────────────────────────────────────
# if command -v aws >/dev/null 2>&1; then
#   AWS_ACCESS_KEY_ID="$SPACES_KEY" \
#   AWS_SECRET_ACCESS_KEY="$SPACES_SECRET" \
#   aws --endpoint-url "https://${SPACES_REGION}.digitaloceanspaces.com" \
#       s3 sync "$BACKUP_DIR" "s3://${SPACES_BUCKET}/r21go-backups/" \
#       --exclude "*" --include "*-${DATE}.sql.gz"
#   echo "[$(date)] Upload Spaces concluído"
# fi

echo "[$(date)] Backup completo"
