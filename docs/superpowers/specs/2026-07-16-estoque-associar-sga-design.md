---
data: 2026-07-16
projeto: 21-go-rastreamento
tags: [estoque, hinova, sga, associacao, clientes-ativos]
tipo: design
---

# Estoque → Associar cliente e ativo via SGA (Fase 1)

## Contexto

Espelhar o fluxo do concorrente RedeVeiculos: na lista de rastreadores
disponíveis (nosso **Estoque**), cada item ganha um menu de ações (10 opções da
Rede) e um atalho **"Associar (SGA)"**. O associar busca a placa no SGA Hinova
em tempo real, cria cliente + veículo + rastreador e move o item pra uma nova
aba **Clientes Ativos**.

Fonte do fluxo real (já em produção): projeto `21 GO - CONTROLE DE ACESSO`
(`app/Services/Hinova/SgaClient.php`) e `21 GO - SGA HINOVA`
(`src/hinova/client.js`, `docs/BASE-CONHECIMENTO-SGA.md`).

## API Hinova SGA v2 (real, confirmada)

- Base: `https://api.hinova.com.br/api/sga/v2`
- Auth: `POST /usuario/autenticar`, header `Authorization: Bearer {HINOVA_SGA_TOKEN}`,
  body `{ usuario, senha }` → `{ mensagem, token_usuario }`. `token_usuario` não
  expira (cachear ~20 dias; reautenticar em 401).
- Veículo: `GET /veiculo/buscar/{PLACA}` → `{ placa, marca, modelo, ano_modelo,
  ano_fabricacao, chassi, renavam, codigo_associado, ... }`
- Associado: `GET /associado/buscar/{codigo}/codigo` → `{ nome, cpf,
  telefone_celular, telefone_fixo, email, codigo_situacao, descricao_situacao }`
- Situação veículo: `GET /buscar/situacao-veiculo/{PLACA}` → `{ codigo_situacao,
  descricao_situacao }`. `codigo_situacao === '1'` = ATIVO.
- Somente leitura (o único POST é a autenticação).

Credenciais copiadas do Controle de Acesso: `HINOVA_SGA_BASE_URL`,
`HINOVA_SGA_TOKEN`, `HINOVA_SGA_USUARIO`, `HINOVA_SGA_SENHA`,
`HINOVA_SGA_VERIFY_SSL`. Nunca commitar; `.env` local + EasyPanel.

## Decisões do usuário

1. Menu com as **10 opções** da Rede. Fase 1 implementa **Associar** + **Remover**;
   as outras 8 aparecem desabilitadas com selo "em breve" (ligam nas Fases 2–4).
2. Ao associar: rastreador **sai do Estoque** e entra na aba **Clientes Ativos**
   com todos os dados do cliente.
3. Chave do vínculo = **IMEI** (item de estoque = rastreador do carro →
   `Vehicle.uniqueId = Device.imei = IMEI`).
4. Dois campos **obrigatórios** no associar: **Nome do técnico** e **Local de
   instalação**. Sem os dois, não ativa.
5. Placa **INATIVA** no SGA (`codigo_situacao !== '1'`) → **bloqueia** o vínculo.
6. Placa **não encontrada** no SGA → **bloqueia** (sem cadastro manual).

## Backend (NestJS)

- **`HinovaService`** reescrito pro fluxo real: `authenticate()` real, cache do
  `token_usuario` no Redis, `searchByPlate`, `searchAssociado`, `situacaoVeiculo`,
  e `lookup(placa)` que agrega os três numa resposta normalizada
  `{ veiculo, associado, situacao, ativo }`. Desligar mock (`HINOVA_MOCK=false`).
- **`GET /hinova/lookup/:placa`** — usado pelo modal (Roles: SUPER_ADMIN, ADMIN, OPERATOR).
- **`POST /stock/:id/associate`** body `{ placa, technicianName, installLocation }`:
  transação, servidor rebusca no SGA (fonte da verdade). Regras: 404 se item não
  existe/já associado; 422 se placa não achada; 422 se INATIVA; 400 se faltar
  técnico/local. Ações: upsert `Associate` (por `hinovaCode`=codigo_associado no
  tenant) → upsert `Vehicle` (`uniqueId=IMEI`, `associateId`, status ACTIVE,
  `hinovaCode`) → cria `Device` (imei, status INSTALLED, `installedBy`=técnico,
  `installLocation`=local, `vehicleId`) → cria device no Traccar → marca
  `StockItem.associatedAt`/`deviceId` (sai da listagem de disponíveis).
- **`GET /associates`** — lista clientes ativos (associado + veículos + device).

## Banco (migration)

- `Device.installLocation String?`
- `StockItem.associatedAt DateTime?` + `StockItem.deviceId String? @unique`
- `findAll` do estoque filtra `associatedAt: null`.

## Frontend (Next.js / dashboard)

- **`/estoque`**: remove a lixeira solta; cada linha ganha botão **"Associar (SGA)"**
  + menu **⋮** (dropdown) com as 10 opções (8 desabilitadas + selo "em breve").
- **Modal Associar**: campo placa → `GET /hinova/lookup` (debounce) → mostra
  cliente + ativo read-only + badge de situação. 2 campos obrigatórios (técnico,
  local). Botão "Ativar cliente" habilita só com placa ATIVA achada + 2 campos.
- **`/clientes`**: nova aba no menu lateral, lista clientes ativos com dados
  completos (cliente, veículo, rastreador, técnico, local).

## Fora de escopo (fases seguintes)

- Fase 2: status operacionais (manutenção, indisponibilizar, perdido, pendência).
- Fase 3: validar instalação (Traccar), enviar SMS, abrir no mapa.
- Fase 4: disponibilizar no login do técnico.
