-- Espelho cadastral do SGA: todo veiculo, em qualquer situacao.
-- Aditiva: cria tabela nova, nao toca em nada existente.
CREATE TABLE IF NOT EXISTS "sga_vehicles" (
    "id" UUID NOT NULL,
    "hinova_vehicle_code" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "chassi" TEXT,
    "associate_name" TEXT NOT NULL,
    "associate_code" TEXT NOT NULL,
    "cpf" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "brand_model" TEXT NOT NULL,
    "situation_code" TEXT NOT NULL,
    "situation_label" TEXT NOT NULL,
    "adhesion_code" TEXT,
    "contract_date" DATE,
    "tenant_id" UUID NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sga_vehicles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sga_vehicles_tenant_id_hinova_vehicle_code_key" ON "sga_vehicles"("tenant_id", "hinova_vehicle_code");
CREATE INDEX IF NOT EXISTS "sga_vehicles_tenant_id_plate_idx" ON "sga_vehicles"("tenant_id", "plate");
CREATE INDEX IF NOT EXISTS "sga_vehicles_tenant_id_chassi_idx" ON "sga_vehicles"("tenant_id", "chassi");
CREATE INDEX IF NOT EXISTS "sga_vehicles_tenant_id_situation_code_idx" ON "sga_vehicles"("tenant_id", "situation_code");

ALTER TABLE "sga_vehicles"
    ADD CONSTRAINT "sga_vehicles_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
