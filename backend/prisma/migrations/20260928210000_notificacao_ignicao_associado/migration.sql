-- Preferência do associado: push quando a chave liga/desliga. Aditiva, nasce desligada.
ALTER TABLE "associates" ADD COLUMN IF NOT EXISTS "notify_ignition_on" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "associates" ADD COLUMN IF NOT EXISTS "notify_ignition_off" BOOLEAN NOT NULL DEFAULT false;
