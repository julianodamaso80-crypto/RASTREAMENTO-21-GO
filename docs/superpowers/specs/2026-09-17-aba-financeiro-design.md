# Aba Financeiro — design

Substitui a planilha mensal do financeiro ("09. FINANCEIRO SETEMBRO").

- **Acesso:** só SUPER_ADMIN e ADMIN (menu, página e API com `@Roles`).
- **Colunas:** placa, situação financeira, mês, nome consultor, ID do comprovante, quantidade de placas.
- **Situação (seletor):** MIGRAÇÃO (verde-claro), PAGO - PIX (verde), SEM COMPROVANTE (laranja) — enum `MIGRATION | PAID_PIX | NO_RECEIPT`.
- **Mês:** 1–12, opcional (a planilha deixa em branco na migração).
- **Tabela:** `financial_entries`, multi-tenant, soft delete; migração aditiva.
- **Tela `/financeiro`:** cartões 3D com total por situação e soma de placas (clicar filtra), busca por placa/consultor/comprovante, filtro de mês e situação, edição direto na linha (salva ao sair do campo), novo lançamento por diálogo.
- **API:** `GET/POST /api/v1/financial-entries`, `PATCH/DELETE /api/v1/financial-entries/:id`.
