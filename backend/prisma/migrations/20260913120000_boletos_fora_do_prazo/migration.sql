-- Achado C3 da revisão final: sem isto "sem boleto" é ambíguo entre "está em
-- dia" e "tem pendência com mais de 5 dias de atraso" — o CRM devolve essa
-- contagem em `foraDoPrazo`, e o app precisa saber para não mentir pro
-- associado que deve.
ALTER TABLE "associates"
  ADD COLUMN IF NOT EXISTS "boletos_fora_do_prazo" INTEGER NOT NULL DEFAULT 0;
