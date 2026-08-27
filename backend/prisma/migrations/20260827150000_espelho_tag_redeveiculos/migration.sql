-- Espelho da TAG que roda na RedeVeiculos (plataforma incumbente).
--
-- Por que tabela propria e nao `devices`: `devices.vehicle_id` e UNIQUE, ou
-- seja, um veiculo tem UM equipamento. Das TAGs ativas, 8.812 estao em veiculo
-- que TAMBEM tem rastreador (adesao 8 no SGA) -- cadastrar a TAG como Device
-- desvincularia o rastreador desses veiculos. Espelho por placa nao encosta
-- em nada disso.
--
-- Aditiva: cria tabela nova, nao toca em nada existente.
CREATE TABLE IF NOT EXISTS "rdv_tags" (
    "id" UUID NOT NULL,
    -- Identificador da TAG na plataforma de origem. E o que aparece como
    -- "Imei" la, mas TAG nao tem IMEI de verdade: e o numero de serie.
    "tag_identifier" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "chassi" TEXT,
    -- REDETAG | KTAG | WGPSTAG | TAG-GT06 (rotulo cru da origem).
    "tag_model" TEXT,
    -- Ultima posicao conhecida. NUNCA e tempo real: a TAG so e vista quando
    -- alguem passa perto. `seen_at` e o carimbo que vale, e a tela mostra a
    -- idade dele sempre.
    "last_lat" DOUBLE PRECISION,
    "last_lng" DOUBLE PRECISION,
    "seen_at" TIMESTAMP(3),
    -- id_ativo na origem, pra reconciliar sem depender da placa.
    "source_asset_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'REDEVEICULOS',
    "tenant_id" UUID NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rdv_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rdv_tags_tenant_id_tag_identifier_key" ON "rdv_tags"("tenant_id", "tag_identifier");
CREATE INDEX IF NOT EXISTS "rdv_tags_tenant_id_plate_idx" ON "rdv_tags"("tenant_id", "plate");
CREATE INDEX IF NOT EXISTS "rdv_tags_tenant_id_seen_at_idx" ON "rdv_tags"("tenant_id", "seen_at" DESC);

ALTER TABLE "rdv_tags"
    ADD CONSTRAINT "rdv_tags_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
