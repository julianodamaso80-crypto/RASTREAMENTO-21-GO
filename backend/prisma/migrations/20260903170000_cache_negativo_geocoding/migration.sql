-- CEP que nenhuma fonte resolve: evita repetir a rede a cada sync de pendências.
-- Aditiva e idempotente: nada existente é tocado.
CREATE TABLE IF NOT EXISTS "cep_geocode_failures" (
    "cep" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "last_tried_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cep_geocode_failures_pkey" PRIMARY KEY ("cep")
);
