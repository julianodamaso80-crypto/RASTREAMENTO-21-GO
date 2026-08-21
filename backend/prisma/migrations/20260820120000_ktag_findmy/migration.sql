ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ble_adv_key_private" TEXT;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ble_adv_key_hashed" TEXT;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ble_turbo_until" TIMESTAMP(3);

ALTER TABLE "ble_sightings" ALTER COLUMN "rssi" DROP NOT NULL;
ALTER TABLE "ble_sightings" ADD COLUMN IF NOT EXISTS "accuracy" INTEGER;
ALTER TABLE "ble_sightings" ADD COLUMN IF NOT EXISTS "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- O DEFAULT acima só vale pra INSERT novo; Postgres avalia CURRENT_TIMESTAMP
-- uma vez e estampa em toda linha pré-existente. Sem isso, todo sighting
-- antigo nasceria ordenado como "visto agora". A verdade sobrevive em
-- created_at, então recuperamos ela aqui.
--
-- O WHERE não é cosmético: esta migration pode ser reaplicada à mão via
-- psql (fallback documentado quando falta permissão pra `prisma migrate
-- deploy`), o que não deixa rastro em _prisma_migrations e permite que o
-- arquivo rode de novo. Sem o filtro, a segunda execução sobrescreveria
-- todo seen_at de verdade (gravado pelo worker, sempre <= created_at) com o
-- instante do POST, perdendo até 7 dias de precisão. O filtro só atinge as
-- linhas que o DEFAULT acima estampou (seen_at > created_at) e nunca as que
-- o worker já preencheu corretamente.
UPDATE "ble_sightings" SET "seen_at" = "created_at" WHERE "seen_at" > "created_at";

CREATE INDEX IF NOT EXISTS "ble_sightings_device_id_seen_at_idx"
  ON "ble_sightings"("device_id", "seen_at" DESC);
