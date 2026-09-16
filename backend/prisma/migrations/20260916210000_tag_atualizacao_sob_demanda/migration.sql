-- Atualização da TAG sob demanda ("Atualizar TAG"), igual ao botão da Rede.
--
-- Aditiva e idempotente. O backend não fala com a Apple (a consulta é Python,
-- no droplet), então a solicitação vira uma linha aqui e o coletor de minuto a
-- minuto a executa. `done_at` + `positions_found` é o que a tela lê para dizer
-- "vieram N avistamentos novos" ou "ninguém passou perto da TAG desde então".

CREATE TABLE IF NOT EXISTS "tag_refresh_requests" (
  "id"              UUID         NOT NULL,
  "tenant_id"       UUID         NOT NULL,
  "serial_number"   TEXT         NOT NULL,
  "requested_by_id" UUID,
  "requested_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "done_at"         TIMESTAMP(3),
  "positions_found" INTEGER,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tag_refresh_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tag_refresh_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "tag_refresh_requests_tenant_serial_pedido_idx"
  ON "tag_refresh_requests"("tenant_id", "serial_number", "requested_at" DESC);
-- O coletor procura por estas: pendentes, mais antigas primeiro.
CREATE INDEX IF NOT EXISTS "tag_refresh_requests_pendentes_idx"
  ON "tag_refresh_requests"("requested_at") WHERE "done_at" IS NULL;
