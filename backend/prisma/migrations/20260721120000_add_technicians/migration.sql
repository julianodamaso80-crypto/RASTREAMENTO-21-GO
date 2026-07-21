-- Técnicos instaladores + reserva de equipamento do estoque.
-- Migração aditiva e idempotente: nenhuma coluna existente é alterada ou removida.

CREATE TABLE IF NOT EXISTS "technicians" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "can_receive_equipment" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "password" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "tenant_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "technicians_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "technicians_tenant_id_cpf_key" ON "technicians"("tenant_id", "cpf");
CREATE INDEX IF NOT EXISTS "technicians_tenant_id_deleted_at_idx" ON "technicians"("tenant_id", "deleted_at");

ALTER TABLE "technicians" DROP CONSTRAINT IF EXISTS "technicians_tenant_id_fkey";
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "assigned_technician_id" UUID;
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMP(3);
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "assigned_by_id" UUID;

CREATE INDEX IF NOT EXISTS "stock_items_tenant_id_assigned_technician_id_idx"
    ON "stock_items"("tenant_id", "assigned_technician_id");

ALTER TABLE "stock_items" DROP CONSTRAINT IF EXISTS "stock_items_assigned_technician_id_fkey";
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_assigned_technician_id_fkey"
    FOREIGN KEY ("assigned_technician_id") REFERENCES "technicians"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "installed_by_technician_id" UUID;

ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_installed_by_technician_id_fkey";
ALTER TABLE "devices" ADD CONSTRAINT "devices_installed_by_technician_id_fkey"
    FOREIGN KEY ("installed_by_technician_id") REFERENCES "technicians"("id") ON DELETE SET NULL ON UPDATE CASCADE;
