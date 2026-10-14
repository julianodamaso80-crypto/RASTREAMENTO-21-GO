-- Históricos de localização gerados em PDF (aba "Solicitados"). Aditiva.
CREATE TABLE IF NOT EXISTS "history_report_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "requested_by_user_id" UUID,
    "requested_by_associate_id" UUID,
    "requested_by_name" TEXT,
    "share_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "row_count" INTEGER NOT NULL,
    "pdf" BYTEA NOT NULL,
    "pdf_size" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "history_report_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "history_report_requests_share_token_key" ON "history_report_requests"("share_token");
CREATE INDEX IF NOT EXISTS "history_report_requests_tenant_id_vehicle_id_created_at_idx" ON "history_report_requests"("tenant_id", "vehicle_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "history_report_requests_requested_by_associate_id_created_at_idx" ON "history_report_requests"("requested_by_associate_id", "created_at" DESC);
