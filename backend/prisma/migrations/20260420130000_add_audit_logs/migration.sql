-- Wave 1.3 — AuditLog
-- Registra operações sensíveis (writes, login, comandos) pra rastreabilidade e compliance.
-- Escopo tenant (nullable pra SUPER_ADMIN agindo cross-tenant e pra login failed antes de resolver user).

CREATE TYPE "AuditAction" AS ENUM (
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'PASSWORD_RESET',
  'COMMAND_SENT',
  'OTHER'
);

CREATE TABLE "audit_logs" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   UUID,
  "user_id"     UUID,
  "user_email"  TEXT,
  "action"      "AuditAction" NOT NULL,
  "entity"      TEXT,
  "entity_id"   TEXT,
  "method"      TEXT         NOT NULL,
  "path"        TEXT         NOT NULL,
  "status_code" INTEGER      NOT NULL,
  "ip"          TEXT,
  "user_agent"  TEXT,
  "metadata"    JSONB,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_tenant_id_created_at_idx"
  ON "audit_logs"("tenant_id", "created_at" DESC);
CREATE INDEX "audit_logs_user_id_created_at_idx"
  ON "audit_logs"("user_id", "created_at" DESC);
CREATE INDEX "audit_logs_entity_entity_id_idx"
  ON "audit_logs"("entity", "entity_id");
CREATE INDEX "audit_logs_action_created_at_idx"
  ON "audit_logs"("action", "created_at" DESC);
