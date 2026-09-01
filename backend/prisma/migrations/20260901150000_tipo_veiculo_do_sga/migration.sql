-- Tipo do veículo como o SGA classifica ("MOTOCICLETA (ATé 400CC)",
-- "VEICULOS LEVES"…). É a fonte de carro x moto no mapa: sem ela, moto nascia
-- com o default CAR e o painel desenhava carro e escrevia "Carro ligado".
ALTER TABLE "sga_vehicles" ADD COLUMN IF NOT EXISTS "vehicle_type" TEXT;
