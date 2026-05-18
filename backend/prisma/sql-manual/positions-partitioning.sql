-- Particionamento mensal da tabela `positions`.
-- Prisma cria a tabela como heap comum em `prisma migrate dev`. Em produção,
-- aplicar ESTE script DEPOIS da migration do Prisma pra converter em tabela
-- particionada antes de qualquer dado de produção entrar.
--
-- Execução (na droplet, dentro do container postgres):
--   psql -U postgres -d rastreamento_21go -f positions-partitioning.sql
--
-- Idempotente: usa IF NOT EXISTS em tudo.

BEGIN;

-- 1. Renomear tabela atual (criada pelo Prisma sem partição)
ALTER TABLE IF EXISTS positions RENAME TO positions_legacy;

-- 2. Criar tabela particionada com a MESMA estrutura
CREATE TABLE IF NOT EXISTS positions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  traccar_position_id integer,
  device_time timestamp(3) NOT NULL,
  server_time timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  speed double precision NOT NULL,
  course double precision,
  altitude double precision,
  accuracy double precision,
  address text,
  ignition boolean,
  battery_level integer,
  power_volts double precision,
  rpm integer,
  fuel double precision,
  temperature double precision,
  odometer double precision,
  gsm_signal integer,
  satellites integer,
  power_cut boolean NOT NULL DEFAULT false,
  jamming boolean NOT NULL DEFAULT false,
  vibration boolean NOT NULL DEFAULT false,
  jarring boolean NOT NULL DEFAULT false,
  charging boolean NOT NULL DEFAULT false,
  alarm text,
  raw_attributes jsonb,
  PRIMARY KEY (id, device_time)
) PARTITION BY RANGE (device_time);

-- Índices da tabela "raiz" (replicados em cada partição automaticamente).
CREATE INDEX IF NOT EXISTS positions_vehicle_device_time_idx
  ON positions (vehicle_id, device_time DESC);
CREATE INDEX IF NOT EXISTS positions_tenant_device_time_idx
  ON positions (tenant_id, device_time DESC);
CREATE INDEX IF NOT EXISTS positions_vehicle_power_cut_idx
  ON positions (vehicle_id, device_time DESC) WHERE power_cut = true;
CREATE INDEX IF NOT EXISTS positions_vehicle_jamming_idx
  ON positions (vehicle_id, device_time DESC) WHERE jamming = true;

-- 3. Criar partições — corrente + próxima + 12 meses retroativos pra histórico.
DO $$
DECLARE
  m integer;
  start_date date;
  end_date date;
  part_name text;
BEGIN
  FOR m IN -12..2 LOOP
    start_date := date_trunc('month', CURRENT_DATE) + (m * INTERVAL '1 month');
    end_date := start_date + INTERVAL '1 month';
    part_name := 'positions_' || to_char(start_date, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF positions FOR VALUES FROM (%L) TO (%L)',
      part_name, start_date, end_date
    );
  END LOOP;
END$$;

-- 4. Migrar dados antigos da tabela legada (se houver).
INSERT INTO positions SELECT * FROM positions_legacy
ON CONFLICT DO NOTHING;

-- 5. Drop da legada (descomentar depois de validar). Mantém comentado por segurança.
-- DROP TABLE positions_legacy;

COMMIT;

-- ───────────────────────────────────────────────────────────────────────
-- Job mensal pra criar partição do próximo mês.
-- Adicionar em cron do sistema (não no NestJS — quanto menos código de infra
-- dentro do app, melhor). Exemplo /etc/cron.d/positions-partition:
--   0 2 1 * * postgres psql -d rastreamento_21go -c "SELECT positions_create_next_partition();"
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION positions_create_next_partition()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  start_date date := date_trunc('month', CURRENT_DATE) + INTERVAL '1 month';
  end_date date := start_date + INTERVAL '1 month';
  part_name text := 'positions_' || to_char(start_date, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF positions FOR VALUES FROM (%L) TO (%L)',
    part_name, start_date, end_date
  );
END$$;

-- Retenção: drop partição com mais de 90 dias (mantém 3 meses quentes).
CREATE OR REPLACE FUNCTION positions_drop_old_partitions(keep_months integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  cutoff_date date := date_trunc('month', CURRENT_DATE) - (keep_months * INTERVAL '1 month');
  r record;
BEGIN
  FOR r IN
    SELECT inhrelid::regclass AS part_name
    FROM pg_inherits
    WHERE inhparent = 'positions'::regclass
  LOOP
    -- nome esperado: positions_YYYY_MM. extrair data e comparar.
    IF substring(r.part_name::text from 'positions_(\d{4}_\d{2})')::text IS NOT NULL THEN
      IF to_date(substring(r.part_name::text from 'positions_(\d{4}_\d{2})'), 'YYYY_MM') < cutoff_date THEN
        EXECUTE format('DROP TABLE %s', r.part_name);
        RAISE NOTICE 'Dropped partition: %', r.part_name;
      END IF;
    END IF;
  END LOOP;
END$$;
