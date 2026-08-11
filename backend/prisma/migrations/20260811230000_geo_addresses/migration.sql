-- Cache de geocodificação reversa. Aditivo: tabela nova, nada existente muda.
CREATE TABLE IF NOT EXISTS "geo_addresses" (
    "id" UUID NOT NULL,
    "lat_key" DOUBLE PRECISION NOT NULL,
    "lng_key" DOUBLE PRECISION NOT NULL,
    "address" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'nominatim',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_addresses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "geo_addresses_lat_key_lng_key_key" ON "geo_addresses"("lat_key", "lng_key");
