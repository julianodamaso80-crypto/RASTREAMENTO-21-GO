-- Libera o associado a bloquear o proprio veiculo pelo app. Aditivo, nasce desligado.
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "blocker_access_allowed" BOOLEAN NOT NULL DEFAULT false;
