# TAG no mapa do Estoque — ver e testar antes de vincular

**Data:** 16/09/2026 · **Status:** desenho aprovado pelo dono

## 1. Problema

O dono precisa **ver onde a TAG está antes de vinculá-la a um veículo**, para
conferir se a localização bate e se a TAG está funcionando. Hoje o botão "Abrir
no mapa" não existe na linha da TAG, e abrir a URL à mão
(`/estoque/mapa?imeis=808092604073255`) devolve **"Nenhum rastreador com esse
filtro"** — o mapa do estoque só entende rastreador. Medido no vídeo que o dono
enviou em 16/09.

## 2. Referência: como a RedeVeiculos faz (medido no vídeo e no aviso da tela)

- O painel lateral do ativo mostra **"Última atualização há 3 minutos"** e o
  endereço do último avistamento.
- Botão verde **"Atualizar Tag"**; ao clicar fica cinza com **contador
  regressivo** (visto `02:45`).
- Campos GPS, Direção, Ignição, Velocidade e Voltagem aparecem vazios para a
  TAG — ela não tem nenhum deles.
- O aviso da própria Rede ("Instruções sobre a Tag") define as regras:
  - **1 TAG no mapa:** atualiza sozinha **a cada 15 minutos**;
  - **atualização manual forçada: a cada 3 minutos**;
  - **2 ou mais TAGs: somente manual**, também a cada 3 minutos.

## 3. Limite honesto (vale para nós e para a Rede)

"Atualizar TAG" **re-consulta a rede da Apple**; não obriga a TAG a se anunciar.
Se nenhum iPhone passou perto dela desde o último avistamento, a posição não
muda — e a tela diz isso ("nenhum avistamento novo desde …"), em vez de fingir
atualização. É a mesma regra de honestidade de `npm run test:tag`: a TAG nunca
é apresentada como posição do momento.

## 4. O que muda

### 4.1 Backend

**Listagem (`GET /stock`)** — para item `kind='TAG'`, devolve `tagPosition`:
`{ lat, lng, accuracyM, seenAt }`, da última linha de `tag_positions` daquele
`serial_number` (uma consulta `DISTINCT ON` para a página inteira). `kind`
continua em cada item (a tela ordena por ele).

**Mapa (`GET /stock/map`)** — hoje filtra `kind='RASTREADOR'`. Passa a incluir
também os pontos de TAG, no mesmo formato `StockMapPoint`, com:
`tipo: 'TAG'`, `latitude/longitude/seenAt` do `tag_positions`, `accuracyM`,
`endereco` pelo `ReverseGeocodeService` (mesmo caminho do rastreador), e
`conexao/ignicao/velocidade/volts/satelites/direcao` **nulos**.

**Atualizar sob demanda (`POST /stock/:id/atualizar-tag`)** — só `kind='TAG'`:
- recusa com 429 se a última solicitação daquela TAG foi há menos de **3 min**,
  devolvendo `disponivelEm`;
- grava em `tag_refresh_requests` e devolve `{ solicitadoEm, disponivelEm }`.

**Estado (`GET /stock/:id/atualizar-tag`)** — devolve
`{ pendente, concluidoEm, avistamentosNovos, disponivelEm }` para a tela
acompanhar o contador e saber se veio posição nova.

**Migration aditiva** `tag_refresh_requests`:
`id, tenant_id, serial_number, requested_by_id, requested_at, done_at,
positions_found, created_at` + índice `(tenant_id, serial_number, requested_at desc)`.

### 4.2 Coletor no droplet

Cron **a cada minuto**: `/root/findmy-sessao/sob-demanda.sh` lê as solicitações
pendentes (limite 20 por rodada), consulta a Apple **só com aquelas chaves**,
grava em `tag_positions` e marca `done_at` + `positions_found`. Usa a mesma
sessão e a mesma imagem da coleta de hora em hora, com `flock` próprio para
nunca rodar junto do ciclo cheio.

### 4.3 Frontend

**Linha da TAG no Estoque:** botão **"Abrir no mapa"** habilitado (some o
`item.kind !== 'TAG'` que o escondia). Sem posição conhecida, o botão fica
desabilitado com o motivo. A coluna Conexão mostra **"vista há X"** no lugar do
selo estático.

**`/estoque/mapa`:** aceita TAG pelo mesmo `?imei=` / `?imeis=`. Marcador roxo
com círculo de precisão. Painel lateral da TAG: número, "vista há X", endereço,
coordenada, e os campos de GPS como "—". Sem Street View e sem "Validar
instalação" (são de rastreador). Botão **"Atualizar TAG"** com contador de
3 min; com 2 ou mais TAGs selecionadas, **só manual** (sem o ciclo de 15 min).
Com **uma** TAG aberta, atualização automática a cada **15 min**.

## 5. Testes

- `stock-tag.spec.ts`: `tagPosition` na listagem; `atualizar-tag` recusa
  rastreador, aplica a trava de 3 min e grava a solicitação.
- Função pura `podeAtualizarTag(ultimaSolicitacao, agora)` com os limites exatos
  (2:59 recusa, 3:01 libera).
- `tag-historico-honesto.js` (`npm run test:tag`) continua verde: nenhuma tela
  de TAG pode dizer ignição, km ou "tempo real".

## 6. Fora do escopo

Filtro "online" (o dono mandou esquecer), TAG no `/mapa` principal, e rastro
completo da TAG no mapa do estoque (a trilha já existe em `/etiquetas-ble/[id]`).
