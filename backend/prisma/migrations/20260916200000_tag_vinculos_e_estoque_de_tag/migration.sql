-- TAG no Estoque e vínculo TAG → associado.
--
-- Aditiva e idempotente: pode ser aplicada à mão via psql.
--
-- `stock_items.kind`: a mesma lista do Estoque passa a ter TAG além de
-- rastreador (pedido do dono em 16/09/2026). TAG não fala com o Traccar, então
-- todo caminho do estoque que envolve servidor GPS filtra `kind = 'RASTREADOR'`.
-- O default mantém cada linha que já existe exatamente como está.
--
-- `tag_links`: o vínculo de uma TAG com um veículo do SGA. Não vira `devices`
-- porque `devices.vehicle_id` é UNIQUE — cadastrar a TAG como device
-- desvincularia o rastreador do carro. Também não cria `vehicles`/`associates`:
-- isso inflaria o Dashboard e poderia expor o veículo no app do associado, e a
-- TAG é segredo interno. O único leitor é o painel interno.

ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'RASTREADOR';
CREATE INDEX IF NOT EXISTS "stock_items_tenant_id_kind_idx" ON "stock_items"("tenant_id", "kind");

CREATE TABLE IF NOT EXISTS "tag_links" (
  "id"                  UUID         NOT NULL,
  "tenant_id"           UUID         NOT NULL,
  "serial_number"       TEXT         NOT NULL,
  "plate"               TEXT         NOT NULL,
  "chassi"              TEXT,
  "hinova_vehicle_code" TEXT,
  "associate_name"      TEXT,
  "associate_cpf"       TEXT,
  "origin"              TEXT         NOT NULL,
  "verdict"             TEXT         NOT NULL,
  "evidence"            JSONB,
  "checked_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id"       UUID,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"          TIMESTAMP(3),
  CONSTRAINT "tag_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tag_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Uma TAG só pode estar vinculada a um veículo por vez (entre os vivos).
CREATE UNIQUE INDEX IF NOT EXISTS "tag_links_tenant_serial_vivo_key"
  ON "tag_links"("tenant_id", "serial_number") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "tag_links_tenant_id_verdict_idx" ON "tag_links"("tenant_id", "verdict");
CREATE INDEX IF NOT EXISTS "tag_links_tenant_id_plate_idx" ON "tag_links"("tenant_id", "plate");
CREATE INDEX IF NOT EXISTS "tag_links_tenant_id_chassi_idx" ON "tag_links"("tenant_id", "chassi");
