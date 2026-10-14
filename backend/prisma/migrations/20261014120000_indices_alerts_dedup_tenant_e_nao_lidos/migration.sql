-- ATENCAO: em PRODUCAO esta migration e aplicada MANUALMENTE, nao por `migrate deploy`.
-- CREATE INDEX CONCURRENTLY nao roda dentro de transacao e o Prisma envolve cada
-- migration em uma. Por isso o SQL abaixo e a variante simples (IF NOT EXISTS),
-- que serve a ambientes novos (CI, dev, banco vazio).
--
-- Procedimento em producao (Regra 0: CRM e loja em 200 antes e depois; fora da
-- janela do backup/purga das 03:00-03:20; checar antes que nao ha indice INVALID
-- com o mesmo nome, pois IF NOT EXISTS o pula em silencio):
--   1. Conectar via DIRECT_URL (nao o pooler), uma instrucao por `psql -c`:
--      SET statement_timeout = 0; SET lock_timeout = '5s';
--      CREATE INDEX CONCURRENTLY IF NOT EXISTS alerts_tenant_id_type_created_at_idx
--        ON alerts (tenant_id, type, created_at DESC);
--      CREATE INDEX CONCURRENTLY IF NOT EXISTS alerts_tenant_id_nao_lidos_idx
--        ON alerts (tenant_id) WHERE read = false;
--   2. Conferir indisvalid = true em pg_index; se INVALID:
--      DROP INDEX CONCURRENTLY IF EXISTS <nome>; e repetir.
--   3. Registrar sem executar: npx prisma migrate resolve --applied 20261014120000_indices_alerts_dedup_tenant_e_nao_lidos
-- Reverter: DROP INDEX CONCURRENTLY IF EXISTS <nome>; (sem perda de dado).
--
-- O indice parcial (WHERE read = false) nao e expressavel no schema.prisma.

CREATE INDEX IF NOT EXISTS "alerts_tenant_id_type_created_at_idx"
  ON "alerts" ("tenant_id", "type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "alerts_tenant_id_nao_lidos_idx"
  ON "alerts" ("tenant_id") WHERE "read" = false;
