-- Onde a TAG foi escondida no veículo. Mesmo papel do `devices.install_location`;
-- preenchido a partir do relatório de Ativos da plataforma de origem
-- (backend/scripts/import-rdv-local-instalacao.ts) e pelo vínculo no painel.
ALTER TABLE "tag_links" ADD COLUMN IF NOT EXISTS "install_location" TEXT;
