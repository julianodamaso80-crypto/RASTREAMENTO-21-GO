---
data: 2026-07-21
projeto: 21 GO Rastreamento
tags: [tecnicos, estoque, instalacao, auth, pwa]
tipo: decisão
---

# Técnicos — cadastro, reserva de equipamento e finalização de instalação em campo

## Contexto

Hoje o vínculo de um rastreador a um cliente acontece só no painel, pelo botão
"Associar (SGA)" em [estoque/page.tsx](../../../frontend/dashboard/src/app/(dashboard)/estoque/page.tsx).
O técnico que fez a instalação é registrado como **texto livre** (`installedBy: string`)
em [stock.service.ts](../../../backend/src/modules/stock/stock.service.ts) — não dá
pra contar instalações por técnico, nem saber o que está na mão de quem, nem deixar
o técnico finalizar sozinho em campo.

O concorrente (RedeVeiculos / `21go.rastreamento.vip`) resolve isso com: aba de
Técnicos, ação "Disponibilizar no login do técnico" item a item, e um app onde o
técnico vê o equipamento reservado e finaliza a instalação.

Este spec cobre a versão 21 GO desse fluxo, com duas melhorias deliberadas sobre a
referência: **reserva em lote** (eles fazem 1 a 1) e **equipamento reservado
continua visível no estoque** com badge de quem está com ele.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Onde o técnico acessa | Web mobile-first (`/tecnico`) no próprio dashboard, PWA instalável | Sem build EAS nem revisão de loja; no ar no mesmo deploy |
| Identidade do técnico | Model `Technician` próprio com auth própria (JWT `type: 'technician'`) | Espelha o padrão já provado em produção do app do associado; isola do painel por construção |
| Login | CPF + senha | Técnico de campo não tem e-mail corporativo; CPF ele sempre sabe |
| Entrega do acesso | Senha provisória gerada pelo sistema, exibida uma vez com texto pronto pro WhatsApp | Zero ida e volta operacional |
| Escopo do técnico em campo | Finalizar instalação completa (placa → SGA → local → sinal → finalizar) | Tira o trabalho manual do escritório |
| Reserva | Seleção em lote por checkbox no estoque | Marcar 1 checkbox cobre o caso avulso; lote resolve expedição de 20 equipamentos |

### Alternativas descartadas

- **`User` com `role = TECHNICIAN`**: reaproveitaria o JWT do dashboard, mas cada
  guard e rota do painel passaria a exigir exceção manual. Um esquecimento = técnico
  terceirizado com acesso à base inteira do tenant.
- **Link assinado sem login**: mais rápido de usar, mas link vazado no WhatsApp
  permite qualquer um finalizar instalação, e não sustenta contagem por técnico.

## Arquitetura

### 1. Modelo de dados (Prisma)

```prisma
model Technician {
  id                  String    @id @default(uuid()) @db.Uuid
  name                String
  cpf                 String                              // só dígitos
  phone               String?
  email               String?
  canReceiveEquipment Boolean   @default(true) @map("can_receive_equipment")
  active              Boolean   @default(true)
  password            String?                             // hash bcrypt; null até 1º acesso
  mustChangePassword  Boolean   @default(true) @map("must_change_password")
  lastLoginAt         DateTime? @map("last_login_at")
  tenantId            String    @map("tenant_id") @db.Uuid
  deletedAt           DateTime? @map("deleted_at")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  tenant      Tenant      @relation(fields: [tenantId], references: [id])
  stockItems  StockItem[]                                 // equipamentos reservados
  devices     Device[]                                    // instalações realizadas

  @@unique([tenantId, cpf])
  @@index([tenantId, deletedAt])
  @@map("technicians")
}
```

**Reserva não vira tabela nova.** Três campos em `StockItem`:

```prisma
assignedTechnicianId String?   @map("assigned_technician_id") @db.Uuid
assignedAt           DateTime? @map("assigned_at")
assignedById         String?   @map("assigned_by_id") @db.Uuid   // User do painel que reservou
assignedTechnician   Technician? @relation(fields: [assignedTechnicianId], references: [id])
@@index([tenantId, assignedTechnicianId])
```

Um campo escalar garante por construção a regra "um equipamento nunca em dois
logins de técnico" — sem N:N, sem estado inconsistente possível.

**Contagem de instalações.** Em `Device`, adicionar `installedByTechnicianId String?`
mantendo o `installedBy` texto para o histórico já gravado. É o campo que sustenta
"Instalações: 391" por técnico.

Migração é **aditiva** (todos os campos nullable / com default) — nenhuma linha
existente quebra.

### 2. Backend

**Módulo `technicians`** (painel, JWT de User, roles `SUPER_ADMIN`/`ADMIN`/`OPERATOR`):

| Rota | Ação |
|---|---|
| `GET /api/v1/technicians` | Lista com busca por nome/CPF; traz `assignedCount` e `installCount` |
| `POST /api/v1/technicians` | Cria técnico e gera senha provisória — retorna `tempPassword` **uma única vez** |
| `PATCH /api/v1/technicians/:id` | Edita dados e `canReceiveEquipment` / `active` |
| `DELETE /api/v1/technicians/:id` | Soft delete; bloqueado se houver equipamento reservado |
| `POST /api/v1/technicians/:id/reset-password` | Nova senha provisória, `mustChangePassword = true` |
| `GET /api/v1/technicians/:id/assignments` | O que está na mão dele agora |

**Módulo `stock`** (rotas novas):

| Rota | Ação |
|---|---|
| `POST /api/v1/stock/assign` | `{ stockItemIds: string[], technicianId }` — reserva em lote |
| `POST /api/v1/stock/unassign` | `{ stockItemIds: string[] }` — devolve ao estoque livre |

Ambas retornam `{ ok: number, skipped: [{ imei, motivo }] }` — nada de falha
silenciosa quando um item do lote já está com outro técnico.

**Módulo `tech`** (campo, JWT `type: 'technician'`):

| Rota | Ação |
|---|---|
| `POST /api/v1/tech/auth/login` | CPF + senha → JWT |
| `GET /api/v1/tech/me` | Dados do técnico logado |
| `POST /api/v1/tech/auth/change-password` | Troca de senha (obrigatória no 1º acesso) |
| `GET /api/v1/tech/assignments` | IMEIs reservados pra ele (com ICCID, linha, operadora, server) |
| `GET /api/v1/tech/lookup?placa=XXX` | Consulta SGA antes de finalizar |
| `GET /api/v1/tech/assignments/:id/signal` | Rastreador já reportou posição no Traccar? (`:id` = `StockItem.id`) |
| `POST /api/v1/tech/assignments/:id/finish` | `{ placa, installLocation, notes? }` — finaliza (`:id` = `StockItem.id`) |

**Reuso do motor de vínculo.** `StockService.associate()` passa a aceitar
`{ technicianId?, technicianName }`. O painel continua chamando como hoje; a rota do
técnico passa o `technicianId`. Uma regra de negócio, um lugar — a validação SGA
(placa inexistente → 422, placa inativa → 422, CPF ausente → 422) não é duplicada.

**Guard.** `TechnicianJwtGuard` espelhando
[associate-jwt.guard.ts](../../../backend/src/modules/app/guards/associate-jwt.guard.ts):
rotas marcadas `@Public()` pra pular o guard global, e o guard próprio valida
`type === 'technician'`, recarrega o técnico do banco (rejeita `active: false` e
`deletedAt`), e popula `req.technician` + `req.tenantId`.

**Senha provisória.** 8 caracteres, alfabeto sem ambiguidade (`23456789ABCDEFGHJKMNPQRSTUVWXYZ`),
`bcrypt` com 10 rounds igual ao associado. Nunca é persistida em claro nem logada.

### 3. Painel — `/tecnicos`

Entrada no sidebar em "Gestão de pessoas", com `roles: NON_CLIENT_ROLES`.

Lista de cards no padrão visual do projeto (paleta navy/laranja do `designer/`):
nome, CPF, telefone, badges **"3 em campo"** e **"127 instalações"**, último login.
Busca por nome ou CPF. Ações por card: editar, reservar equipamentos, ver o que está
com ele, resetar senha, ativar/desativar.

**Cadastro em uma tela só.** Modal com nome, CPF, celular e toggle "pode receber
equipamentos" → salvar → a mesma modal vira tela de sucesso mostrando a senha
provisória, com botão **"copiar mensagem do WhatsApp"** já montada:

```
Olá {nome}! Seu acesso ao 21 GO:
https://trackgo.site/tecnico
CPF: {cpf}   Senha: {senha}
Troque a senha no primeiro acesso.
```

A senha só aparece nesse momento. Perdeu, gera outra pelo "resetar senha".

### 4. Painel — reserva em lote no estoque

Na tabela de [estoque](../../../frontend/dashboard/src/app/(dashboard)/estoque/page.tsx):

- coluna de checkbox por linha + "selecionar todos da página";
- barra flutuante quando há seleção: *"12 selecionados · Enviar pro técnico"*;
- modal com combo de técnicos (só `active && canReceiveEquipment`) → confirma;
- item reservado **continua na listagem** com badge "Com Iury" e ação "Cancelar reserva";
- filtro novo: Todos / Livres / Com técnico;
- o item "Disponibilizar no login do técnico" do menu de 3 pontinhos (hoje desabilitado)
  passa a abrir a mesma modal com aquele item pré-selecionado.

Manter o reservado visível é deliberado: com 3.700 itens, equipamento que "some" da
tela é equipamento perdido no controle.

### 5. Campo — `/tecnico` (PWA)

Rota fora do grupo `(dashboard)` — layout próprio, sem sidebar, alvo de toque grande.

1. **Login** — CPF (com máscara) + senha.
2. **Primeiro acesso** — força troca de senha antes de qualquer tela.
3. **Home** — cards grandes: modelo + IMEI + operadora, botão "Instalar".
4. **Instalar** — campo placa (uppercase automático) → "Buscar no SGA" → mostra
   cliente, modelo e situação → local de instalação (select de opções comuns +
   "outro" com texto livre) → botão "Verificar sinal" (opcional, consulta Traccar) →
   "Finalizar instalação".
5. **Sucesso** — o equipamento sai da lista dele imediatamente.

Sem modo offline na v1: conexão ruim mostra erro explícito e permite tentar de novo,
nunca finaliza pela metade.

## Fluxo de dados

```
Operador                          Sistema                         Técnico
   |                                 |                               |
   |-- cadastra técnico ------------>|                               |
   |<-- senha provisória (1x) -------|                               |
   |-- WhatsApp com CPF+senha ------------------------------------->|
   |                                 |<-- login CPF+senha -----------|
   |                                 |--- troca senha obrigatória -->|
   |-- seleciona 12 IMEIs ---------->|                               |
   |   "enviar pro técnico"          |-- StockItem.assigned* --------|
   |                                 |<-- lista de reservados -------|
   |                                 |<-- placa (lookup SGA) --------|
   |                                 |--- cliente/modelo/situação -->|
   |                                 |<-- finalizar instalação ------|
   |                          StockService.associate()               |
   |                     (Associate + Vehicle + Device + Traccar)    |
   |<-- estoque atualizado ----------|--- some da lista dele ------->|
```

## Tratamento de erro

| Situação | Resposta |
|---|---|
| Placa não existe no SGA | 422 com o motivo do SGA (regra já existente) |
| Placa inativa no SGA | 422 "placa X está INATIVA no SGA — vínculo bloqueado" |
| Item do lote já reservado por outro técnico | Não aborta o lote: entra em `skipped` com motivo |
| Item já associado (fora do estoque) | 404 "não encontrado ou já associado" (regra existente) |
| Técnico desativado tenta logar | 401 genérico "CPF ou senha inválidos" |
| Técnico tenta finalizar IMEI que não é dele | 404 — nunca 403, pra não confirmar existência |
| Traccar fora do ar | Vínculo conclui mesmo assim (best-effort já implementado), log de warning |
| Excluir técnico com equipamento em campo | 409 "devolva os N equipamentos antes de excluir" |

## Testes

- **Isolamento**: técnico A não lista nem finaliza IMEI reservado pro técnico B.
- **Multi-tenant**: técnico de um tenant não enxerga estoque de outro; CPF repetido
  em tenants diferentes resolve pelo hash da senha (mesmo padrão do associado).
- **Lote**: 3 itens, 1 já reservado → 2 `ok`, 1 `skipped` com motivo.
- **Fluxo completo (e2e)**: cadastra técnico → reserva → login → troca senha →
  finaliza com placa válida → `Device.installedByTechnicianId` preenchido e item
  fora da lista do técnico.
- **Bloqueios do SGA**: placa inexistente e placa inativa retornam 422 pela rota
  do técnico exatamente como pela rota do painel.

## Fora de escopo (v1)

Fotos da instalação, checklist digital, leitor de código de barras por câmera, aba
de análises/ranking com gráficos, notificação push pro técnico. Todos dependem de
storage (DigitalOcean Spaces) ou de volume de dados que só existe depois do fluxo
rodando.

## Links relacionados

- [[MEMORIA-21Go]]
- [CLAUDE.md](../../../CLAUDE.md) — roadmap Wave 2.2 (Agendamentos + OS) consome esta base
- [stock.service.ts](../../../backend/src/modules/stock/stock.service.ts) — motor de vínculo reaproveitado
- [associate-auth.service.ts](../../../backend/src/modules/app/associate-auth.service.ts) — padrão de auth por CPF replicado
