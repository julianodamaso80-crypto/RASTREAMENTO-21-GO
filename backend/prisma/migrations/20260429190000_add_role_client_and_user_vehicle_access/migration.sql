-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'CLIENT';

-- CreateTable
CREATE TABLE "user_vehicle_access" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_vehicle_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_vehicle_access_user_id_vehicle_id_key" ON "user_vehicle_access"("user_id", "vehicle_id");

-- CreateIndex
CREATE INDEX "user_vehicle_access_vehicle_id_idx" ON "user_vehicle_access"("vehicle_id");

-- AddForeignKey
ALTER TABLE "user_vehicle_access" ADD CONSTRAINT "user_vehicle_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_vehicle_access" ADD CONSTRAINT "user_vehicle_access_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
