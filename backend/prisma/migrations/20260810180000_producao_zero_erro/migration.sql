-- Wave A/B/C do plano docs/PLANO-PRODUCAO-ZERO-ERRO.md
-- Tudo aditivo e idempotente: nenhuma coluna é removida ou renomeada.

-- === P0.1 — Posição precisa ser distinguível de posição chutada ===
-- fix_time: momento REAL do fix de GPS (device_time/server_time avançam em
-- keep-alive sem fix novo). valid: falso quando o Traccar marcou a posição como
-- inválida/aproximada (LBS por torre de celular).
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "fix_time" TIMESTAMP(3);
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "valid" BOOLEAN NOT NULL DEFAULT true;

-- Backfill do histórico: sem fix_time gravado, device_time é a melhor
-- aproximação existente (era o que a persistência antiga usava).
UPDATE "positions" SET "fix_time" = "device_time" WHERE "fix_time" IS NULL;

-- === P2.3 — Uma posição do Traccar nunca entra duas vezes ===
-- A cada reconexão do WebSocket o Traccar reemite o estado atual de todos os
-- devices; sem esta trava, cada restart do backend duplicava pontos no replay.
-- Deduplica o que já entrou (mantém a linha mais antiga de cada id) antes de
-- criar o índice único.
DELETE FROM "positions" p
USING "positions" q
WHERE p."traccar_position_id" IS NOT NULL
  AND p."traccar_position_id" = q."traccar_position_id"
  AND (p."server_time" > q."server_time"
       OR (p."server_time" = q."server_time" AND p."id" > q."id"));

CREATE UNIQUE INDEX IF NOT EXISTS "positions_traccar_position_id_key"
  ON "positions" ("traccar_position_id");

-- === P1.8 — Troca de senha obrigatória no app do associado ===
-- Primeiro acesso é CPF/CPF; depois disso só a senha escolhida pelo cliente
-- vale. Default true: quem já entrou com CPF será obrigado a trocar.
ALTER TABLE "associates" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT true;

-- === P0.2 — Conferência de GPS no ato da instalação ===
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "install_check_fix_time" TIMESTAMP(3);
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "install_check_lat" DOUBLE PRECISION;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "install_check_lng" DOUBLE PRECISION;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "install_check_distance_m" INTEGER;

-- === P1.7 — Retirada de rastreador (aparelho volta pro estoque) ===
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "uninstalled_at" TIMESTAMP(3);
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "uninstalled_by" TEXT;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "uninstall_reason" TEXT;

-- === P1.5 — Parada de rota cancelada quando a pendência morre no SGA ===
ALTER TABLE "route_stops" ADD COLUMN IF NOT EXISTS "note" TEXT;
