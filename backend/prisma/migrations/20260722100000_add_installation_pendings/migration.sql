-- Pendências de instalação de rastreador/TAG espelhadas do SGA Hinova.
-- Migração aditiva e idempotente: cria uma tabela nova, não altera nenhuma existente.

CREATE TABLE IF NOT EXISTS "installation_pendings" (
    "id" UUID NOT NULL,
    "hinova_vehicle_code" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "pending_type" TEXT NOT NULL,
    "associate_name" TEXT NOT NULL,
    "associate_code" TEXT NOT NULL,
    "cpf" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "brand_model" TEXT NOT NULL,
    "vehicle_type" TEXT,
    "city" TEXT,
    "neighborhood" TEXT,
    "protected_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "contract_date" DATE NOT NULL,
    "evaluation_table" TEXT,
    "consultant_name" TEXT,
    "tenant_id" UUID NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "installation_pendings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "installation_pendings_tenant_id_hinova_vehicle_code_key"
    ON "installation_pendings"("tenant_id", "hinova_vehicle_code");
CREATE INDEX IF NOT EXISTS "installation_pendings_tenant_id_contract_date_idx"
    ON "installation_pendings"("tenant_id", "contract_date");
CREATE INDEX IF NOT EXISTS "installation_pendings_tenant_id_pending_type_idx"
    ON "installation_pendings"("tenant_id", "pending_type");

ALTER TABLE "installation_pendings" DROP CONSTRAINT IF EXISTS "installation_pendings_tenant_id_fkey";
ALTER TABLE "installation_pendings" ADD CONSTRAINT "installation_pendings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
