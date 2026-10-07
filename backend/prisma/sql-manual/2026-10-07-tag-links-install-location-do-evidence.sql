-- O "Associar (SGA)" de TAG gravava o local de instalação só em
-- evidence->>'localInstalacao' e deixava a coluna install_location nula, então
-- o painel mostrava "Não informado". Copia o local já digitado para a coluna.
-- Aditivo: só preenche onde está vazio, nunca sobrescreve. Rodar via DIRECT_URL.
--
-- Conferir antes:
--   SELECT count(*) FROM tag_links
--    WHERE origin = 'ESTOQUE' AND deleted_at IS NULL AND install_location IS NULL
--      AND NULLIF(btrim(evidence->>'localInstalacao'), '') IS NOT NULL;

UPDATE tag_links
   SET install_location = btrim(evidence->>'localInstalacao')
 WHERE origin = 'ESTOQUE'
   AND deleted_at IS NULL
   AND install_location IS NULL
   AND NULLIF(btrim(evidence->>'localInstalacao'), '') IS NOT NULL;
