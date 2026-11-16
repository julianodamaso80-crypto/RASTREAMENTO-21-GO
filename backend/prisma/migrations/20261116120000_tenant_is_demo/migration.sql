-- Empresa de demonstração: tudo funciona, nada sai para o mundo real (aditiva).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "is_demo" BOOLEAN NOT NULL DEFAULT false;
