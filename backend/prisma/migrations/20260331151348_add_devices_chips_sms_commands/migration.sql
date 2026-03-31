-- CreateEnum
CREATE TYPE "DeviceModel" AS ENUM ('GT06N', 'GT06', 'ST310U', 'ST340', 'ST350', 'J16', 'J16_PRO', 'CRX3', 'CRX3_NANO', 'CRX_PRO_4G', 'TK103', 'TK303', 'FMB920', 'FMB120', 'COBAN_GPS103', 'CONCOX_GT06N', 'SINOTRACK_ST901', 'SINOTRACK_ST905', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('PENDING_INSTALL', 'INSTALLED', 'CONFIGURING', 'ONLINE', 'OFFLINE', 'MAINTENANCE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ChipOperator" AS ENUM ('VIVO', 'CLARO', 'TIM', 'OI', 'MULTI_OPERATOR');

-- CreateEnum
CREATE TYPE "ApnType" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ChipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommandType" AS ENUM ('SET_SERVER_IP', 'SET_APN', 'SET_TIMER', 'SET_TIMEZONE', 'BLOCK', 'UNBLOCK', 'RESTART', 'GET_LOCATION', 'GET_PARAMS', 'GET_IMEI', 'FACTORY_RESET', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'RESPONDED', 'FAILED');

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "imei" TEXT NOT NULL,
    "model" "DeviceModel" NOT NULL,
    "brand" TEXT,
    "firmware_version" TEXT,
    "serial_number" TEXT,
    "traccar_device_id" INTEGER,
    "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING_INSTALL',
    "chip_id" UUID,
    "vehicle_id" UUID,
    "tenant_id" UUID NOT NULL,
    "installed_at" TIMESTAMP(3),
    "installed_by" TEXT,
    "last_connection" TIMESTAMP(3),
    "notes" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chips" (
    "id" UUID NOT NULL,
    "iccid" TEXT NOT NULL,
    "phone_number" TEXT,
    "operator" "ChipOperator" NOT NULL,
    "apn" TEXT NOT NULL,
    "apn_user" TEXT,
    "apn_password" TEXT,
    "apn_type" "ApnType" NOT NULL DEFAULT 'PRIVATE',
    "data_plan_mb" INTEGER NOT NULL DEFAULT 50,
    "provider" TEXT,
    "status" "ChipStatus" NOT NULL DEFAULT 'ACTIVE',
    "activated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "tenant_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_commands" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "command" TEXT NOT NULL,
    "type" "CommandType" NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "response" TEXT,
    "responded_at" TIMESTAMP(3),
    "sent_by" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_imei_key" ON "devices"("imei");

-- CreateIndex
CREATE UNIQUE INDEX "devices_chip_id_key" ON "devices"("chip_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_vehicle_id_key" ON "devices"("vehicle_id");

-- CreateIndex
CREATE INDEX "devices_tenant_id_status_idx" ON "devices"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "chips_iccid_key" ON "chips"("iccid");

-- CreateIndex
CREATE INDEX "chips_tenant_id_status_idx" ON "chips"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sms_commands_device_id_created_at_idx" ON "sms_commands"("device_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_chip_id_fkey" FOREIGN KEY ("chip_id") REFERENCES "chips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chips" ADD CONSTRAINT "chips_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_commands" ADD CONSTRAINT "sms_commands_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
