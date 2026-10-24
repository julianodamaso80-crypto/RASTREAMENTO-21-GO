-- Histórico de localização da TAG em PDF. Aditiva e reversível:
-- a TAG de cliente nem sempre tem veículo cadastrado (só o vínculo com a placa),
-- então o veículo deixa de ser obrigatório e a TAG é identificada pelo número.
ALTER TABLE "history_report_requests" ALTER COLUMN "vehicle_id" DROP NOT NULL;
ALTER TABLE "history_report_requests" ADD COLUMN IF NOT EXISTS "tag_serial" TEXT;
CREATE INDEX IF NOT EXISTS "history_report_requests_tenant_id_tag_serial_created_at_idx" ON "history_report_requests"("tenant_id", "tag_serial", "created_at" DESC);
