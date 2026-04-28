-- Wave 1.1 — Soft delete universal
-- Adiciona deleted_at nos models que ainda não tinham: tenants, users, associates, alerts, geofences.
-- (Vehicle, Device, Chip já tinham deleted_at desde migrations anteriores.)
-- Adiciona também updated_at em alerts (faltava) — preparando pra Wave 1.2 (workflow de alerta).
-- Safe pra prod: ADD COLUMN NULL + DEFAULT não faz lock pesado de tabela em Postgres 17.

ALTER TABLE "tenants" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "associates" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "geofences" ADD COLUMN "deleted_at" TIMESTAMP(3);

ALTER TABLE "alerts"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Índices scoped por tenant pra lookup eficiente de "ativos" (deletedAt IS NULL).
CREATE INDEX "users_tenant_id_deleted_at_idx" ON "users"("tenant_id", "deleted_at");
CREATE INDEX "associates_tenant_id_deleted_at_idx" ON "associates"("tenant_id", "deleted_at");
CREATE INDEX "alerts_tenant_id_deleted_at_idx" ON "alerts"("tenant_id", "deleted_at");
CREATE INDEX "geofences_tenant_id_deleted_at_idx" ON "geofences"("tenant_id", "deleted_at");
