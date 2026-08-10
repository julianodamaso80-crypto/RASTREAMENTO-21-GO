-- Telas liberadas por usuário. Vazio = todas as telas do role (comportamento antigo).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "allowed_routes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
