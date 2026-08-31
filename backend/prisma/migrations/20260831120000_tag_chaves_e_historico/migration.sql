-- Chaves das TAGs e histórico próprio de posição.
--
-- Aditiva e idempotente: pode ser aplicada à mão via psql sem quebrar nada, que
-- é o caminho usado quando falta permissão para `prisma migrate deploy`.
--
-- Por que duas tabelas novas em vez de reusar as existentes:
--
--   `devices` guarda a chave da TAG só quando ela virou equipamento de um
--   veículo. Mas a chave chega do fabricante no ato da COMPRA do lote, muito
--   antes da instalação — e das 11 mil TAGs do parque só 1 existe como device.
--
--   `rdv_tags` guarda UMA linha por TAG, sobrescrita a cada sincronização. Não
--   há como extrair rastro nem padrão de uma linha que se apaga.
--
-- `tag_positions.source` é o que permite cortar a plataforma de origem sem
-- refazer nada: o coletor próprio grava na mesma tabela com 'APPLE_FINDMY'.

CREATE TABLE IF NOT EXISTS "tag_keys" (
  "id"             UUID         NOT NULL,
  "serial_number"  TEXT         NOT NULL,
  "mac_address"    TEXT,
  "private_key"    TEXT         NOT NULL,
  "hashed_adv_key" TEXT         NOT NULL,
  "batch"          TEXT,
  "tenant_id"      UUID         NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tag_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tag_keys_tenant_id_serial_number_key"
  ON "tag_keys"("tenant_id", "serial_number");
CREATE INDEX IF NOT EXISTS "tag_keys_tenant_id_hashed_adv_key_idx"
  ON "tag_keys"("tenant_id", "hashed_adv_key");
CREATE INDEX IF NOT EXISTS "tag_keys_tenant_id_batch_idx"
  ON "tag_keys"("tenant_id", "batch");

CREATE TABLE IF NOT EXISTS "tag_positions" (
  "id"            UUID         NOT NULL,
  "serial_number" TEXT         NOT NULL,
  "plate"         TEXT,
  "latitude"      DOUBLE PRECISION NOT NULL,
  "longitude"     DOUBLE PRECISION NOT NULL,
  "accuracy_m"    INTEGER,
  "seen_at"       TIMESTAMP(3) NOT NULL,
  "received_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source"        TEXT         NOT NULL,
  "tenant_id"     UUID         NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tag_positions_pkey" PRIMARY KEY ("id")
);

-- O mesmo avistamento nunca entra duas vezes: a coleta repete a janela de 7
-- dias a cada ciclo, por construção do protocolo.
CREATE UNIQUE INDEX IF NOT EXISTS "tag_positions_tenant_serial_seen_key"
  ON "tag_positions"("tenant_id", "serial_number", "seen_at");
CREATE INDEX IF NOT EXISTS "tag_positions_tenant_serial_seen_idx"
  ON "tag_positions"("tenant_id", "serial_number", "seen_at" DESC);
CREATE INDEX IF NOT EXISTS "tag_positions_tenant_plate_seen_idx"
  ON "tag_positions"("tenant_id", "plate", "seen_at" DESC);
CREATE INDEX IF NOT EXISTS "tag_positions_tenant_seen_idx"
  ON "tag_positions"("tenant_id", "seen_at" DESC);

DO $$ BEGIN
  ALTER TABLE "tag_keys" ADD CONSTRAINT "tag_keys_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "tag_positions" ADD CONSTRAINT "tag_positions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
