-- Recuperação de senha do app do associado por código no WhatsApp.
-- Aditivo: nenhuma coluna removida, nenhum dado alterado.

-- Código guardado como HASH: vazar o banco não entrega códigos válidos.
ALTER TABLE "associates" ADD COLUMN IF NOT EXISTS "reset_code_hash" TEXT;
ALTER TABLE "associates" ADD COLUMN IF NOT EXISTS "reset_code_expires_at" TIMESTAMP(3);
ALTER TABLE "associates" ADD COLUMN IF NOT EXISTS "reset_code_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "associates" ADD COLUMN IF NOT EXISTS "reset_code_sent_at" TIMESTAMP(3);
