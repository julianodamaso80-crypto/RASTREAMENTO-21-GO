-- Wave 1.2 — Workflow de Alerta
-- Alertas deixam de ser notificações read/unread e passam a ter ciclo de vida:
-- OPEN → IN_PROGRESS (operador assume) → RESOLVED (com observação obrigatória)
-- Histórico auditável em alert_history pra rastrear quem fez o quê.

CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

CREATE TYPE "AlertHistoryAction" AS ENUM (
  'CREATED',
  'ASSIGNED',
  'UNASSIGNED',
  'COMMENTED',
  'RESOLVED',
  'REOPENED'
);

ALTER TABLE "alerts"
  ADD COLUMN "status"         "AlertStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "assigned_to_id" UUID,
  ADD COLUMN "assigned_at"    TIMESTAMP(3),
  ADD COLUMN "resolved_by_id" UUID,
  ADD COLUMN "resolved_at"    TIMESTAMP(3),
  ADD COLUMN "resolution"     TEXT;

CREATE INDEX "alerts_tenant_id_status_created_at_idx"
  ON "alerts"("tenant_id", "status", "created_at" DESC);
CREATE INDEX "alerts_assigned_to_id_status_idx"
  ON "alerts"("assigned_to_id", "status");

CREATE TABLE "alert_history" (
  "id"         UUID                 NOT NULL DEFAULT gen_random_uuid(),
  "alert_id"   UUID                 NOT NULL,
  "user_id"    UUID,
  "user_email" TEXT,
  "action"     "AlertHistoryAction" NOT NULL,
  "comment"    TEXT,
  "metadata"   JSONB,
  "created_at" TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "alert_history_alert_id_fkey"
    FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE
);

CREATE INDEX "alert_history_alert_id_created_at_idx"
  ON "alert_history"("alert_id", "created_at" DESC);
