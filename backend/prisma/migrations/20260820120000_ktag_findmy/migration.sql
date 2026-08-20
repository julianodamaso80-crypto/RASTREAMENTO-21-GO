ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ble_adv_key_private" TEXT;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ble_adv_key_hashed" TEXT;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ble_turbo_until" TIMESTAMP(3);

ALTER TABLE "ble_sightings" ALTER COLUMN "rssi" DROP NOT NULL;
ALTER TABLE "ble_sightings" ADD COLUMN IF NOT EXISTS "accuracy" INTEGER;
ALTER TABLE "ble_sightings" ADD COLUMN IF NOT EXISTS "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "ble_sightings_device_id_seen_at_idx"
  ON "ble_sightings"("device_id", "seen_at" DESC);
