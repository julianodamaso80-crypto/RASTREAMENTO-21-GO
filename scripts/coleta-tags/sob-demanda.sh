#!/usr/bin/env bash
#
# "Atualizar TAG": consulta a rede Find My só das TAGs que alguém pediu no
# painel. Roda a cada minuto pelo cron.
#
# Por que existe: o backend é Node e não fala com a Apple — quem fala é o
# Python do coletor. O botão do painel grava uma linha em `tag_refresh_requests`
# e este script a executa, gravando `done_at` e `positions_found`. O zero em
# `positions_found` é resposta honesta: ninguém passou perto da TAG.
#
# Proteções (a conta Apple é o ativo frágil — bloqueio derruba TODAS as TAGs):
#   - flock próprio E o do ciclo cheio: as duas coletas nunca correm juntas;
#   - teto de 20 TAGs por rodada;
#   - PARADO: se a sessão foi recusada, nem tenta (mesmo arquivo do ciclo cheio).
set -uo pipefail

PASTA=/root/findmy-sessao
LOG=/var/log/coleta-tags.log
PARADO="$PASTA/PARADO"
IMAGEM=localhost:5000/r21go-ktag-worker:findmy-0.10.2
TETO=20

registrar() { echo "[$(date '+%F %T')] sob-demanda: $*" >> "$LOG"; }

[ -f "$PARADO" ] && exit 0

cid=$(docker ps -q -f name=rastreamento-21-go_postgres-rastreamento | head -1)
[ -z "$cid" ] && { registrar "ERRO: banco não encontrado"; exit 1; }

psql() { docker exec "$cid" psql -U postgres -d rastreamento21go -t -A "$@"; }

# 1. Pedidos pendentes (mais antigos primeiro), com a chave privada da TAG.
psql -F'|' -c "
  SELECT r.id, k.serial_number, k.private_key
    FROM tag_refresh_requests r
    JOIN tag_keys k ON k.serial_number = r.serial_number AND k.tenant_id = r.tenant_id
   WHERE r.done_at IS NULL
   ORDER BY r.requested_at
   LIMIT $TETO;" > "$PASTA/pedidos.csv" 2>>"$LOG"

quantos=$(grep -c . "$PASTA/pedidos.csv" 2>/dev/null || echo 0)
[ "$quantos" -eq 0 ] && exit 0
registrar "$quantos pedido(s)"

# 2. O coletar.py espera `numero|chave|placa`. A placa é vazia aqui.
awk -F'|' '{print $2"|"$3"|"}' "$PASTA/pedidos.csv" > "$PASTA/todas-sob-demanda.csv"

# Nunca junto do ciclo cheio: o lock é o mesmo do cron de hora em hora.
rm -f "$PASTA/posicoes-sob-demanda.csv"
flock /tmp/coleta-tags.lock docker run --rm --network container:anisette \
  -v "$PASTA":/sessao \
  -e ENTRADA=/sessao/todas-sob-demanda.csv \
  -e SAIDA=/sessao/posicoes-sob-demanda.csv \
  "$IMAGEM" python -u /sessao/coletar.py >> "$LOG" 2>&1
status=$?

if [ $status -eq 3 ]; then
  echo "sessão da Apple recusada em $(date '+%F %T')" > "$PARADO"
  registrar "SESSÃO RECUSADA — suspenso até login novo"
  exit 3
fi

# 3. Grava os avistamentos e fecha os pedidos, mesmo que não tenha vindo nada:
#    pedido sem resposta que fica pendente para sempre trava o botão do painel.
novos=0
if [ -s "$PASTA/posicoes-sob-demanda.csv" ]; then
  docker cp "$PASTA/posicoes-sob-demanda.csv" "$cid":/tmp/pos.csv >/dev/null
  novos=$(psql -c "
    CREATE TEMP TABLE p(serial_number text, plate text, latitude double precision,
                        longitude double precision, accuracy_m int, seen_at timestamptz);
    COPY p FROM '/tmp/pos.csv' WITH (FORMAT csv);
    WITH t AS (SELECT id FROM tenants LIMIT 1),
    ins AS (
      INSERT INTO tag_positions (id, serial_number, plate, latitude, longitude,
                                 accuracy_m, seen_at, received_at, source, tenant_id, created_at)
      SELECT gen_random_uuid(), p.serial_number, NULLIF(p.plate,''), p.latitude, p.longitude,
             p.accuracy_m, p.seen_at AT TIME ZONE 'UTC', now(), 'APPLE_FINDMY', t.id, now()
        FROM p, t
      ON CONFLICT (tenant_id, serial_number, seen_at) DO NOTHING
      RETURNING serial_number)
    SELECT count(*) FROM ins;" | tr -d ' ')
  docker exec "$cid" rm -f /tmp/pos.csv
fi

ids=$(cut -d'|' -f1 "$PASTA/pedidos.csv" | paste -sd"','" -)
psql -c "UPDATE tag_refresh_requests
            SET done_at = now(),
                positions_found = COALESCE((
                  SELECT count(*) FROM tag_positions tp
                   WHERE tp.serial_number = tag_refresh_requests.serial_number
                     AND tp.received_at > tag_refresh_requests.requested_at), 0)
          WHERE id IN ('$ids');" > /dev/null 2>>"$LOG"

registrar "fim — $novos avistamento(s) novo(s) em $quantos TAG(s)"
rm -f "$PASTA/pedidos.csv" "$PASTA/todas-sob-demanda.csv"
exit 0
