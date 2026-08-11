-- Clientes Ativos vira lista por ativo (paridade com a tela /veiculos do
-- concorrente, auditada em 11/08/2026).
--
-- `financial_status` / `financial_status_at`: situação financeira espelhada do
-- SGA. Preenchida no ato do vínculo (o lookup por placa já traz) e reconsultada
-- por cron diário. Null = nunca consultada — o card diz isso, não inventa
-- "em dia".
--
-- `sga_status_label`: descrição da situação do veículo no SGA (ATIVO,
-- CANCELADO, SUBSTITUIDO, INATIVO). O `status` da tabela é o nosso estado, não
-- o deles; sem esta coluna não dá pra mostrar um ativo que saiu do SGA mas
-- continua com rastreador instalado.
--
-- `app_access_blocked`: corta o acesso do associado a ESTE ativo no app do
-- cliente, sem mexer na senha dele nem nos outros veículos.
--
-- Tudo aditivo e com default: nenhuma linha existente muda de comportamento.

ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "financial_status" TEXT;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "financial_status_at" TIMESTAMP(3);
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "sga_status_label" TEXT;
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "app_access_blocked" BOOLEAN NOT NULL DEFAULT false;

-- O cron varre exatamente isto: ativo do tenant com placa, ainda vivo.
CREATE INDEX IF NOT EXISTS "vehicles_financial_sync_idx"
  ON "vehicles" ("tenant_id", "financial_status_at")
  WHERE "deleted_at" IS NULL;
