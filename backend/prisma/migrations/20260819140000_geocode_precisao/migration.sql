-- Endereço deixa de ser "o da célula de 110 m" e passa a ser "o da coordenada
-- que foi realmente geocodificada". Guardar a coordenada real permite medir a
-- distância até o ponto pedido e recusar o cache quando ele está longe demais.
ALTER TABLE "geo_addresses" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "geo_addresses" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;

-- Linhas antigas foram resolvidas a partir do centro de uma célula de ~110 m:
-- a chave É a coordenada que foi geocodificada. Preencher com ela mantém o
-- histórico utilizável sem fingir uma precisão que não existe.
UPDATE "geo_addresses" SET "lat" = "lat_key", "lng" = "lng_key" WHERE "lat" IS NULL;
