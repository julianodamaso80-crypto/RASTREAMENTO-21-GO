-- Senha provisória: o painel obriga a criar a própria senha (aditiva).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;
