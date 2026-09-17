-- Comprovante de pagamento anexado ao lançamento do Financeiro. Aditivo.

CREATE TABLE IF NOT EXISTS "financial_receipts" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "financial_receipts_entry_id_key" ON "financial_receipts"("entry_id");

DO $$ BEGIN
  ALTER TABLE "financial_receipts" ADD CONSTRAINT "financial_receipts_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "financial_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
