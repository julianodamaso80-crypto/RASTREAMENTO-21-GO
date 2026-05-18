-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('OIL_CHANGE', 'OIL_FILTER', 'AIR_FILTER', 'FUEL_FILTER', 'BELT', 'TIRES', 'BRAKES', 'ALIGNMENT', 'BATTERY', 'COOLANT', 'TRANSMISSION_OIL', 'SPARK_PLUG', 'GENERAL_REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceSeverity" AS ENUM ('UPCOMING', 'DUE', 'OVERDUE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertType" ADD VALUE 'POWER_CUT';
ALTER TYPE "AlertType" ADD VALUE 'JAMMING';
ALTER TYPE "AlertType" ADD VALUE 'VEHICLE_BATTERY_LOW';
ALTER TYPE "AlertType" ADD VALUE 'HARSH_BRAKE';
ALTER TYPE "AlertType" ADD VALUE 'HARSH_ACCEL';
ALTER TYPE "AlertType" ADD VALUE 'FUEL_THEFT';
ALTER TYPE "AlertType" ADD VALUE 'MAINTENANCE_DUE';
ALTER TYPE "AlertType" ADD VALUE 'ENGINE_OVERHEATING';
ALTER TYPE "AlertType" ADD VALUE 'COLLISION';

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "severity" "AlertSeverity" NOT NULL DEFAULT 'INFO';

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "speed_threshold_kmh" INTEGER NOT NULL DEFAULT 120,
    "offline_threshold_minutes" INTEGER NOT NULL DEFAULT 15,
    "battery_device_low_threshold" INTEGER NOT NULL DEFAULT 20,
    "battery_vehicle_low_volts" DOUBLE PRECISION NOT NULL DEFAULT 11.5,
    "harsh_brake_kmh_per_sec" DOUBLE PRECISION NOT NULL DEFAULT -10,
    "harsh_accel_kmh_per_sec" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "fuel_drop_percent_for_theft" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "fuel_drop_window_minutes" INTEGER NOT NULL DEFAULT 5,
    "engine_overheat_celsius" INTEGER NOT NULL DEFAULT 100,
    "idle_speed_kmh" INTEGER NOT NULL DEFAULT 2,
    "auto_block_on_power_cut" BOOLEAN NOT NULL DEFAULT false,
    "jamming_confirm_readings" INTEGER NOT NULL DEFAULT 2,
    "notify_channels" JSONB NOT NULL DEFAULT '{"email":true,"push":true,"whatsapp":false}',
    "notify_types" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "name" TEXT NOT NULL,
    "interval_km" INTEGER,
    "interval_engine_hours" INTEGER,
    "interval_months" INTEGER,
    "last_done_at" TIMESTAMP(3),
    "last_done_km" DOUBLE PRECISION,
    "last_done_engine_hours" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "severity" "MaintenanceSeverity",
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_scores" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "total_score" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "km_analyzed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "token_usage" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "traccar_position_id" INTEGER,
    "device_time" TIMESTAMP(3) NOT NULL,
    "server_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "course" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "address" TEXT,
    "ignition" BOOLEAN,
    "battery_level" INTEGER,
    "power_volts" DOUBLE PRECISION,
    "rpm" INTEGER,
    "fuel" DOUBLE PRECISION,
    "temperature" DOUBLE PRECISION,
    "odometer" DOUBLE PRECISION,
    "gsm_signal" INTEGER,
    "satellites" INTEGER,
    "power_cut" BOOLEAN NOT NULL DEFAULT false,
    "jamming" BOOLEAN NOT NULL DEFAULT false,
    "vibration" BOOLEAN NOT NULL DEFAULT false,
    "jarring" BOOLEAN NOT NULL DEFAULT false,
    "charging" BOOLEAN NOT NULL DEFAULT false,
    "alarm" TEXT,
    "raw_attributes" JSONB,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "maintenance_plans_tenant_id_deleted_at_idx" ON "maintenance_plans"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "maintenance_plans_vehicle_id_active_idx" ON "maintenance_plans"("vehicle_id", "active");

-- CreateIndex
CREATE INDEX "vehicle_scores_tenant_id_period_end_idx" ON "vehicle_scores"("tenant_id", "period_end" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_scores_vehicle_id_period_end_key" ON "vehicle_scores"("vehicle_id", "period_end");

-- CreateIndex
CREATE INDEX "assistant_conversations_user_id_created_at_idx" ON "assistant_conversations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "assistant_messages_conversation_id_created_at_idx" ON "assistant_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "positions_vehicle_id_device_time_idx" ON "positions"("vehicle_id", "device_time" DESC);

-- CreateIndex
CREATE INDEX "positions_tenant_id_device_time_idx" ON "positions"("tenant_id", "device_time" DESC);

-- CreateIndex
CREATE INDEX "positions_vehicle_id_power_cut_device_time_idx" ON "positions"("vehicle_id", "power_cut", "device_time" DESC);

-- CreateIndex
CREATE INDEX "positions_vehicle_id_jamming_device_time_idx" ON "positions"("vehicle_id", "jamming", "device_time" DESC);

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_scores" ADD CONSTRAINT "vehicle_scores_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
