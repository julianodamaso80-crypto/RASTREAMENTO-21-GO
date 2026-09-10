-- Recuperação de senha por código no WhatsApp: campos aditivos, nada é removido.
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "pending_phone" TEXT;
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "phone_verified_at" TIMESTAMP(3);
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "reset_code_hash" TEXT;
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "reset_code_expires_at" TIMESTAMP(3);
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "reset_code_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "reset_code_sent_at" TIMESTAMP(3);

ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "pending_phone" TEXT;
ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "phone_verified_at" TIMESTAMP(3);
ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "reset_code_hash" TEXT;
ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "reset_code_expires_at" TIMESTAMP(3);
ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "reset_code_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "reset_code_sent_at" TIMESTAMP(3);

ALTER TABLE "associates"  ADD COLUMN IF NOT EXISTS "pending_phone" TEXT;
ALTER TABLE "associates"  ADD COLUMN IF NOT EXISTS "phone_verified_at" TIMESTAMP(3);
