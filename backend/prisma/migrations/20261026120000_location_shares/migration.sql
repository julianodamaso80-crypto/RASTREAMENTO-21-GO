-- Link "compartilhar localização" (veículo ao vivo, sem login, com prazo). Aditiva.
CREATE TABLE IF NOT EXISTS "location_shares" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "requested_by_user_id" UUID,
    "requested_by_associate_id" UUID,
    "requested_by_name" TEXT,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "location_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "location_shares_token_key" ON "location_shares"("token");
CREATE INDEX IF NOT EXISTS "location_shares_tenant_id_vehicle_id_created_at_idx" ON "location_shares"("tenant_id", "vehicle_id", "created_at" DESC);
