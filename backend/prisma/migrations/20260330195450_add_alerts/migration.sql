-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('SPEED', 'IGNITION_ON', 'IGNITION_OFF', 'SOS', 'BATTERY_LOW', 'OFFLINE', 'GEOFENCE_IN', 'GEOFENCE_OUT');

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "type" "AlertType" NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "vehicle_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alerts_tenant_id_created_at_idx" ON "alerts"("tenant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
