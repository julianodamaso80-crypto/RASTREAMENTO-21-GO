-- Aba Financeiro. Tudo aditivo: nenhuma tabela ou coluna existente é tocada.

DO $$ BEGIN
  CREATE TYPE "FinancialEntryStatus" AS ENUM ('MIGRATION', 'PAID_PIX', 'NO_RECEIPT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "financial_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "status" "FinancialEntryStatus" NOT NULL,
    "month" INTEGER,
    "consultant_name" TEXT,
    "receipt_id" TEXT,
    "plate_count" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "financial_entries_tenant_id_deleted_at_idx" ON "financial_entries"("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "financial_entries_tenant_id_plate_idx" ON "financial_entries"("tenant_id", "plate");

DO $$ BEGIN
  ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
