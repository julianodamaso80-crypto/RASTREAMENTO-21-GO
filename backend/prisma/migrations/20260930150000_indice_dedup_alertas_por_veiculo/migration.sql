-- Dedup do cron de alertas (OFFLINE/GPS_SILENT) consulta alerts por
-- vehicle_id + type + created_at a cada minuto, por veiculo; sem indice
-- era seq scan em 1M de linhas (205 ms cada, Postgres a 540% de CPU).
-- Criado em producao com CONCURRENTLY em 30/09/2026; aqui e no-op.
CREATE INDEX IF NOT EXISTS "alerts_vehicle_id_type_created_at_idx"
  ON "alerts" ("vehicle_id", "type", "created_at" DESC);
