-- "Rede consultada há X": o mapa mostra quando foi a última vez que o coletor
-- perguntou à Apple (max(received_at) do tenant). Sem índice era seq scan em
-- 5,1 milhões de linhas. Criado em produção com CONCURRENTLY em 30/09/2026;
-- aqui é no-op.
CREATE INDEX IF NOT EXISTS "tag_positions_tenant_received_idx"
  ON "tag_positions" ("tenant_id", "received_at" DESC);
