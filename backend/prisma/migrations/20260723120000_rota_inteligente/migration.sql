-- Rota inteligente de instalação: endereço + coordenadas nas pendências, cache
-- de geocoding por CEP, e models de rota (route + stops).
-- Aditiva e idempotente: só cria colunas/tabelas novas.

-- 1. Endereço e coordenadas na pendência
ALTER TABLE "installation_pendings" ADD COLUMN IF NOT EXISTS "cep"    TEXT;
ALTER TABLE "installation_pendings" ADD COLUMN IF NOT EXISTS "street" TEXT;
ALTER TABLE "installation_pendings" ADD COLUMN IF NOT EXISTS "number" TEXT;
ALTER TABLE "installation_pendings" ADD COLUMN IF NOT EXISTS "lat"    DOUBLE PRECISION;
ALTER TABLE "installation_pendings" ADD COLUMN IF NOT EXISTS "lng"    DOUBLE PRECISION;

-- 2. Cache de geocoding por CEP
CREATE TABLE IF NOT EXISTS "cep_coordinates" (
    "cep"        TEXT NOT NULL,
    "lat"        DOUBLE PRECISION NOT NULL,
    "lng"        DOUBLE PRECISION NOT NULL,
    "source"     TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cep_coordinates_pkey" PRIMARY KEY ("cep")
);

-- 3. Rota
CREATE TABLE IF NOT EXISTS "installation_routes" (
    "id"             UUID NOT NULL,
    "tenant_id"      UUID NOT NULL,
    "technician_id"  UUID NOT NULL,
    "assigned_by_id" UUID,
    "status"         TEXT NOT NULL DEFAULT 'PENDING',
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "installation_routes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "installation_routes_tenant_id_technician_id_status_idx"
    ON "installation_routes"("tenant_id", "technician_id", "status");

ALTER TABLE "installation_routes" DROP CONSTRAINT IF EXISTS "installation_routes_tenant_id_fkey";
ALTER TABLE "installation_routes" ADD CONSTRAINT "installation_routes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "installation_routes" DROP CONSTRAINT IF EXISTS "installation_routes_technician_id_fkey";
ALTER TABLE "installation_routes" ADD CONSTRAINT "installation_routes_technician_id_fkey"
    FOREIGN KEY ("technician_id") REFERENCES "technicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Paradas da rota (com snapshot dos dados da pendência)
CREATE TABLE IF NOT EXISTS "route_stops" (
    "id"                  UUID NOT NULL,
    "route_id"            UUID NOT NULL,
    "order"               INTEGER NOT NULL,
    "status"              TEXT NOT NULL DEFAULT 'PENDING',
    "done_at"             TIMESTAMP(3),
    "hinova_vehicle_code" TEXT NOT NULL,
    "plate"               TEXT NOT NULL,
    "pending_type"        TEXT NOT NULL,
    "associate_name"      TEXT NOT NULL,
    "phone"               TEXT,
    "brand_model"         TEXT NOT NULL,
    "street"              TEXT,
    "number"              TEXT,
    "neighborhood"        TEXT,
    "city"                TEXT,
    "cep"                 TEXT,
    "lat"                 DOUBLE PRECISION,
    "lng"                 DOUBLE PRECISION,
    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "route_stops_route_id_order_idx" ON "route_stops"("route_id", "order");

ALTER TABLE "route_stops" DROP CONSTRAINT IF EXISTS "route_stops_route_id_fkey";
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_fkey"
    FOREIGN KEY ("route_id") REFERENCES "installation_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
