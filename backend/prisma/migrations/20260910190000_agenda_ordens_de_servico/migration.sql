-- Agenda / Ordens de Serviço. Tudo aditivo: nenhuma tabela ou coluna existente
-- é tocada. Espelha o módulo /agendamentos/ da plataforma de origem.

DO $$ BEGIN
  CREATE TYPE "ServiceType" AS ENUM ('INSTALLATION', 'MAINTENANCE', 'REMOVAL', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MaintenanceReason" AS ENUM ('WITH_REPLACEMENT', 'WITHOUT_REPLACEMENT', 'INSTALL_FAILURE', 'SIGNAL_FAILURE', 'WORKSHOP', 'AFTER_THEFT', 'LINE_OFF', 'GPS_FAILURE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ServiceConduction" AS ENUM ('FIXED_POINT', 'MOBILE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AppointmentShift" AS ENUM ('MORNING', 'AFTERNOON', 'NIGHT', 'ALL_DAY', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CANCELED', 'COMPLETED', 'POSTPONED', 'ANTICIPATED', 'FRUSTRATED_CLIENT', 'FRUSTRATED_TECHNICIAN', 'CLOSED_BY_SYSTEM', 'EXECUTED', 'CLIENT_NO_SHOW', 'CANCELED_BY_CLIENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TechnicianServiceStatus" AS ENUM ('SCHEDULED', 'CANCELED', 'COMPLETED', 'FRUSTRATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ExecutionTiming" AS ENUM ('ON_TIME', 'TECHNICIAN_LATE', 'ANTICIPATED_BY_TECHNICIAN', 'TECHNICIAN_EARLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "appointments" (
    "id" UUID NOT NULL,
    "os_number" TEXT NOT NULL,
    "service_type" "ServiceType" NOT NULL,
    "maintenance_reason" "MaintenanceReason",
    "conduction" "ServiceConduction" NOT NULL DEFAULT 'MOBILE',
    "scheduled_start" TIMESTAMP(3) NOT NULL,
    "scheduled_end" TIMESTAMP(3) NOT NULL,
    "shift" "AppointmentShift" NOT NULL DEFAULT 'CUSTOM',
    "technician_id" UUID NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "technician_status" "TechnicianServiceStatus",
    "execution_timing" "ExecutionTiming" NOT NULL DEFAULT 'ON_TIME',
    "status_note" TEXT,
    "status_changed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_lat" DOUBLE PRECISION,
    "completed_lng" DOUBLE PRECISION,
    "location_denied" BOOLEAN NOT NULL DEFAULT false,
    "vehicle_id" UUID,
    "plate" TEXT,
    "chassi" TEXT,
    "imei" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "install_location" TEXT,
    "client_name" TEXT,
    "cpf_cnpj" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "cep" TEXT,
    "address" TEXT,
    "complement" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "value" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "technician_note" TEXT,
    "technician_reply" TEXT,
    "auto_scheduled" BOOLEAN NOT NULL DEFAULT false,
    "installation_pending_id" UUID,
    "created_by_id" UUID,
    "tenant_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "appointments_tenant_id_os_number_key" ON "appointments"("tenant_id", "os_number");
CREATE INDEX IF NOT EXISTS "appointments_tenant_id_technician_id_scheduled_start_idx" ON "appointments"("tenant_id", "technician_id", "scheduled_start");
CREATE INDEX IF NOT EXISTS "appointments_tenant_id_scheduled_start_deleted_at_idx" ON "appointments"("tenant_id", "scheduled_start", "deleted_at");
CREATE INDEX IF NOT EXISTS "appointments_tenant_id_status_idx" ON "appointments"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "appointments_tenant_id_plate_idx" ON "appointments"("tenant_id", "plate");

DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_technician_id_fkey"
    FOREIGN KEY ("technician_id") REFERENCES "technicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
