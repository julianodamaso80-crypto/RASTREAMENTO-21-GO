#!/usr/bin/env bash
#
# Um ciclo de coleta das TAGs na rede Find My.
#
#   banco (chaves) -> container findmy (consulta a Apple) -> banco (posições)
#
# Chamado pelo cron de hora em hora. A frequência é conservadora de propósito:
# a rede Find My leva de 8 a 47 minutos para reportar, então consultar mais
# rápido não traria posição mais nova — só aumentaria o risco de a conta Apple
# ser bloqueada, e um bloqueio derruba TODAS as TAGs de uma vez.
#
# Proteções:
#   - flock: duas coletas nunca rodam juntas, mesmo se uma demorar mais de 1h
#   - PARADO: se a Apple recusar a sessão, o script cria este arquivo e todas
#     as execuções seguintes saem na hora. Insistir contra uma sessão recusada
#     é o caminho mais curto para perder a conta. Some quando alguém refizer o
#     login e apagar o arquivo.
set -uo pipefail

PASTA=/root/findmy-sessao
LOG=/var/log/coleta-tags.log
PARADO="$PASTA/PARADO"
IMAGEM=localhost:5000/r21go-ktag-worker:latest

registrar() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

if [ -f "$PARADO" ]; then
  registrar "PARADO: $(cat "$PARADO"). Refaça o login e apague $PARADO."
  exit 0
fi

cid=$(docker ps -q -f name=rastreamento-21-go_postgres-rastreamento | head -1)
if [ -z "$cid" ]; then
  registrar "ERRO: container do banco não encontrado"
  exit 1
fi

# 1. Chaves que vamos consultar, com a placa quando conhecida.
docker exec "$cid" psql -U postgres -d rastreamento21go -t -A -F'|' -c \
  "SELECT k.serial_number, k.private_key, COALESCE(t.plate,'')
     FROM tag_keys k
     LEFT JOIN rdv_tags t ON regexp_replace(t.tag_identifier,'^0+','') = k.serial_number;" \
  > "$PASTA/todas.csv" 2>>"$LOG"

quantas=$(wc -l < "$PASTA/todas.csv")
registrar "inicio — $quantas chaves"

# 2. Consulta à Apple.
rm -f "$PASTA/posicoes.csv"
docker run --rm --network container:anisette \
  -v "$PASTA":/sessao "$IMAGEM" \
  python -u /sessao/coletar.py >> "$LOG" 2>&1
status=$?

if [ $status -eq 3 ]; then
  echo "sessão da Apple recusada em $(date '+%F %T')" > "$PARADO"
  registrar "SESSÃO RECUSADA — coleta suspensa até login novo"
  exit 3
fi
if [ $status -ne 0 ]; then
  registrar "coleta falhou (status $status) — tentará no próximo ciclo"
  exit $status
fi

# 3. Grava no banco. O índice único (tenant, número, visto_em) descarta o que
#    já existe — a Apple devolve os mesmos 7 dias a cada consulta, então
#    repetição é o normal, não erro.
if [ ! -s "$PASTA/posicoes.csv" ]; then
  registrar "nenhum avistamento novo neste ciclo"
  exit 0
fi

docker cp "$PASTA/posicoes.csv" "$cid":/tmp/pos.csv >/dev/null 2>&1
gravadas=$(docker exec "$cid" psql -U postgres -d rastreamento21go -t -A -c "
CREATE TEMP TABLE imp(sn text, placa text, lat double precision, lng double precision, prec text, visto text);
COPY imp FROM '/tmp/pos.csv' WITH (FORMAT csv);
WITH inseridas AS (
  INSERT INTO tag_positions
    (id, serial_number, plate, latitude, longitude, accuracy_m, seen_at, received_at, source, tenant_id, created_at)
  SELECT gen_random_uuid(), i.sn, nullif(i.placa,''), i.lat, i.lng,
         nullif(i.prec,'')::int, i.visto::timestamp, now(), 'APPLE_FINDMY', t.id, now()
    FROM imp i
    CROSS JOIN (SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1) t
  ON CONFLICT (tenant_id, serial_number, seen_at) DO NOTHING
  RETURNING 1
)
SELECT count(*) FROM inseridas;" 2>>"$LOG" | tail -1 | tr -d ' ')

docker exec "$cid" rm -f /tmp/pos.csv 2>/dev/null
lidas=$(wc -l < "$PASTA/posicoes.csv")
registrar "fim — $lidas avistamentos lidos, $gravadas novos gravados"
