-- Conferência de instalação antes de vincular o rastreador no SGA.
--
-- `traccar_device_id`: o estoque inteiro passa a ser cadastrado no servidor GPS.
-- Sem device no Traccar, tudo que o rastreador manda é descartado — e não havia
-- como conferir a instalação ANTES do vínculo, que é quando importa.
--
-- Colunas de validação: selo informativo (não bloqueia o vínculo, decisão do
-- dono). `validation_snapshot` guarda o retrato da telemetria no aceite
-- (voltagem, ignição, satélites, coordenada, motivos).
--
-- Tudo aditivo e opcional: nenhuma linha existente é afetada.

ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "traccar_device_id" INTEGER;
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "validated_at" TIMESTAMP(3);
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "validated_by_id" UUID;
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "validated_by_name" TEXT;
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "validation_ok" BOOLEAN;
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "validation_notes" TEXT;
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "validation_snapshot" JSONB;

-- O cron de sincronização procura exatamente por isto: item disponível ainda
-- sem device no servidor GPS.
CREATE INDEX IF NOT EXISTS "stock_items_traccar_pendentes_idx"
  ON "stock_items" ("tenant_id")
  WHERE "traccar_device_id" IS NULL AND "associated_at" IS NULL AND "deleted_at" IS NULL;
