-- Tipo do veículo (carro x moto). Define o desenho usado como marcador no mapa.
-- Aditivo e seguro: veículos já cadastrados recebem CAR por padrão.

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'MOTORCYCLE');

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN "vehicle_type" "VehicleType" NOT NULL DEFAULT 'CAR';
