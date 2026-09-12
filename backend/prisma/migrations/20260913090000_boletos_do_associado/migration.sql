-- Espelho dos boletos que o app mostra. Descartável: a fonte é o CRM.
CREATE TABLE IF NOT EXISTS "associate_boletos" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       UUID NOT NULL,
  "associate_id"    UUID NOT NULL,
  "nosso_numero"    TEXT NOT NULL,
  "plate"           TEXT,
  "mes_referente"   TEXT,
  "valor"           DECIMAL(12,2),
  "vencimento"      TEXT,
  "status"          TEXT NOT NULL,
  "linha_digitavel" TEXT,
  "pdf_bytes"       INTEGER,
  "avisado_em"      TIMESTAMPTZ,
  "atualizado_em"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "criado_em"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "associate_boletos_tenant_numero_key"
  ON "associate_boletos" ("tenant_id", "nosso_numero");
CREATE INDEX IF NOT EXISTS "associate_boletos_associate_idx"
  ON "associate_boletos" ("associate_id", "vencimento");

-- O PDF mora em tabela à parte: 3,4 MB por linha não pode pesar a consulta da lista.
CREATE TABLE IF NOT EXISTS "associate_boleto_pdfs" (
  "nosso_numero" TEXT PRIMARY KEY,
  "tenant_id"    UUID NOT NULL,
  "conteudo"     BYTEA NOT NULL,
  "baixado_em"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Aparelho que recebe push. Uma linha por aparelho, não por pessoa.
CREATE TABLE IF NOT EXISTS "associate_push_devices" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    UUID NOT NULL,
  "associate_id" UUID NOT NULL,
  "expo_token"   TEXT NOT NULL,
  "platform"     TEXT NOT NULL,
  "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "associate_push_devices_token_key"
  ON "associate_push_devices" ("expo_token");
CREATE INDEX IF NOT EXISTS "associate_push_devices_associate_idx"
  ON "associate_push_devices" ("associate_id");

-- Sem isto, "lista vazia" é ambíguo: não dá para saber se o associado está em dia
-- ou se o robô ainda não passou por ele. NULL = nunca carregado.
ALTER TABLE "associates"
  ADD COLUMN IF NOT EXISTS "boletos_sincronizados_em" TIMESTAMPTZ;
