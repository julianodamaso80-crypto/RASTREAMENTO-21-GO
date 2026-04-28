-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeviceModel" ADD VALUE 'BLE_KTAG';
ALTER TYPE "DeviceModel" ADD VALUE 'BLE_REDTAG';
ALTER TYPE "DeviceModel" ADD VALUE 'BLE_AIRTAG_GENERIC';

-- DropForeignKey
ALTER TABLE "alert_history" DROP CONSTRAINT "alert_history_alert_id_fkey";

-- DropIndex
DROP INDEX "users_reset_token_expires_at_idx";

-- AlterTable
ALTER TABLE "alert_history" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "alerts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ble_sightings" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "mac_address" TEXT NOT NULL,
    "rssi" INTEGER NOT NULL,
    "hashed_adv_key" TEXT,
    "counter_byte" INTEGER,
    "scanner_lat" DOUBLE PRECISION,
    "scanner_lng" DOUBLE PRECISION,
    "scanner_source" TEXT,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ble_sightings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ble_sightings_tenant_id_created_at_idx" ON "ble_sightings"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ble_sightings_device_id_created_at_idx" ON "ble_sightings"("device_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ble_sightings" ADD CONSTRAINT "ble_sightings_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ble_sightings" ADD CONSTRAINT "ble_sightings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
