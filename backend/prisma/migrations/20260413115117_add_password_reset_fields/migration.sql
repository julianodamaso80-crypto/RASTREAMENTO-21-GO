-- Password reset flow: campos hash + expiração no User
-- Safe pra prod: ADD COLUMN NULL não faz lock de tabela em Postgres
ALTER TABLE "users"
  ADD COLUMN "reset_token_hash" TEXT,
  ADD COLUMN "reset_token_expires_at" TIMESTAMP(3);

-- Índice pra lookup rápido durante reset (a tabela é pequena, mas já deixa preparado)
CREATE INDEX "users_reset_token_expires_at_idx" ON "users"("reset_token_expires_at");
