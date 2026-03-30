-- CreateEnum
CREATE TYPE "GeofenceType" AS ENUM ('POLYGON', 'CIRCLE');

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "GeofenceType" NOT NULL,
    "coordinates" JSONB NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "traccar_geofence_id" INTEGER,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofence_vehicles" (
    "id" UUID NOT NULL,
    "geofence_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofence_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "geofence_vehicles_geofence_id_vehicle_id_key" ON "geofence_vehicles"("geofence_id", "vehicle_id");

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_vehicles" ADD CONSTRAINT "geofence_vehicles_geofence_id_fkey" FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_vehicles" ADD CONSTRAINT "geofence_vehicles_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
