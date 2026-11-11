-- Número impresso na etiqueta quando difere do serial do arquivo (aditivo, nulo nos antigos).
ALTER TABLE "tag_keys" ADD COLUMN IF NOT EXISTS "label_serial" TEXT;
CREATE INDEX IF NOT EXISTS "tag_keys_tenant_id_label_serial_idx" ON "tag_keys"("tenant_id", "label_serial");
