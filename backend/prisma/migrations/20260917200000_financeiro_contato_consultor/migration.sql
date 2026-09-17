-- Aba Financeiro: contato do consultor ao lado do nome. Aditivo.
ALTER TABLE "financial_entries" ADD COLUMN IF NOT EXISTS "consultant_contact" TEXT;
