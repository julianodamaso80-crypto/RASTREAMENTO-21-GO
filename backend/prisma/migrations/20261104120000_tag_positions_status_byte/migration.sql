-- Bateria da TAG: byte de status do relatório Find My (aditivo, nulo nos antigos).
ALTER TABLE "tag_positions" ADD COLUMN IF NOT EXISTS "status_byte" SMALLINT;
