-- Consultores espelhados do painel do Power CRM (aba /consultores).
--
-- Aditiva e idempotente: tabela nova, nada existente muda. Um cron do backend
-- reescreve as linhas a partir do Power; quem some de lá ganha deleted_at.

CREATE TABLE IF NOT EXISTS "consultants" (
  "id"               UUID         NOT NULL,
  "tenant_id"        UUID         NOT NULL,
  "power_id"         INTEGER      NOT NULL,
  "name"             TEXT         NOT NULL,
  "nickname"         TEXT,
  "email"            TEXT,
  "document"         TEXT,
  "phone"            TEXT,
  "mobile"           TEXT,
  "office"           INTEGER,
  "office_label"     TEXT,
  "branch"           TEXT,
  "cooperative"      TEXT,
  "permission_group" TEXT,
  "manager_name"     TEXT,
  "active"           BOOLEAN      NOT NULL DEFAULT true,
  "status_label"     TEXT,
  "power_created_at" TIMESTAMP(3),
  "last_access_at"   TIMESTAMP(3),
  "blocked_at"       TIMESTAMP(3),
  "synced_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  "deleted_at"       TIMESTAMP(3),
  CONSTRAINT "consultants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consultants_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "consultants_tenant_id_power_id_key"
  ON "consultants"("tenant_id", "power_id");
CREATE INDEX IF NOT EXISTS "consultants_tenant_id_active_idx"
  ON "consultants"("tenant_id", "active");
CREATE INDEX IF NOT EXISTS "consultants_tenant_id_name_idx"
  ON "consultants"("tenant_id", "name");
