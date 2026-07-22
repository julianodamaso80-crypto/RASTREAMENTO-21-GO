-- Veículo aguardando emplacamento entra na fila sem placa: o chassi é o que
-- identifica o carro em campo. Eram 357 casos na base em 22/07/2026, todos
-- descartados em silêncio quando a placa era obrigatória.
-- Aditiva e idempotente.

ALTER TABLE "installation_pendings" ADD COLUMN IF NOT EXISTS "chassi" TEXT;
