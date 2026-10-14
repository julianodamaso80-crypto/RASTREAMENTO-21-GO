# Correção da lentidão do painel — Plano de implementação (revisão 2, 14/10/2026)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar do thread único do backend o trabalho repetido que o painel do escritório dispara (`/stock/map` e frota montados por aba e por chamada) e as travadas do mapa do estoque, **sem mudar dado, permissão nem fluxo**, com cada comportamento novo nascendo **desligado** e ligável por configuração.

**Architecture:** Payloads que são iguais para todos os usuários de um tenant passam a ser montados uma vez por janela e servidos de um cache em memória com *single-flight* (uma montagem em voo por chave), versão por invalidação e limite de entradas. A frota ganha `ETag` forte por tenant e responde `304` sem montar nada. O painel, em modo "contingência", usa o WebSocket (lote de 1 s) como fonte e só consulta por HTTP quando o socket está fora ou para reconciliar a cada 60 s; o modo "legado" (hoje) continua sendo o padrão de build. O mapa do estoque ganha o mesmo cluster do mapa principal. **Nada aqui toca banco, alertas, app do associado ou retenção** — esses viram propostas separadas (Task E).

**Tech Stack:** NestJS 11 + Prisma 7 + Express (backend, 1 réplica), Next.js 16 / React 19 / axios / socket.io-client (dashboard), `supercluster` (já instalado), jest 30 + ts-jest (hoisted no `node_modules` da raiz).

**Spec:** `docs/research/2026-10-13-investigacao-lentidao-causa-raiz.md` (medições) + a missão do dono de 14/10/2026 (seções 3–10: isolamento, proteções e critérios). Onde este plano e o relatório divergirem, vale a missão.

**Base:** branch `perf/lentidao-painel` criada de `206709d` (frontend em produção; contém `b366657`, backend em produção). `origin/main` está em `b366657` — **`206709d` ainda não foi integrado ao main** (branch `fix/mapa-lista-virtualizada` de outra sessão). Integrar esta branch exige integrar `206709d` junto.

## Global Constraints

- **Produção não é tocada por este plano.** Sem deploy, merge, push, migration, índice, reinício, alteração de dado ou de configuração. Testes e builds só na worktree, com dados sintéticos; nenhum teste aponta para `api.trackgo.site`, Traccar ou Postgres de produção.
- **Comportamento novo nasce desligado.** Backend: `STOCK_MAP_CACHE_MS` (padrão ausente = `0` = caminho de hoje) e `FROTA_PAINEL_CACHE_MS` (idem). Frontend: `NEXT_PUBLIC_POLLING_MODE` (`legado` padrão | `contingencia`) e `NEXT_PUBLIC_STOCK_MAP_CLUSTER` (`off` padrão | `on`). Ligar/desligar no backend = trocar env + reiniciar o serviço (~20 s); no frontend = rebuild + deploy. **Não existe desligamento instantâneo sem reinício** — documentar assim.
- Multi-tenant: toda chave de cache começa por `tenantId`; autenticação (`JwtAuthGuard`) e `TenantGuard` continuam antes de qualquer leitura de cache.
- Topologia real: **1 réplica** do backend (`docker service ls`, 14/10). Cache e single-flight em processo cobrem 100 % das chamadas. Sem Redis.
- Ambiente local: `pdfkit` não está instalado no `node_modules` local, por isso **14 suítes do backend que importam `app.module`/`stock.service` falham ao carregar** (pré-existente, `Test Suites: 14 failed, 80 passed; Tests: 713 passed`). Não instalar dependências; rodar as suítes do módulo tocado e registrar a falha pré-existente.
- Sem refatoração fora do escopo; sem atualizar dependências; sem `git stash`/limpeza destrutiva; commits pequenos em português (`tipo(escopo): descrição`) com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Idade máxima dos dados: `/stock/map` ≤ 10 s de cache (TTL) — a tela já atualiza a cada 15 s; frota ≤ 2 s (igual ao coalesce de hoje em `TraccarService.FROTA_CACHE_MS`). Timestamps de origem (`fixTime`, `lastUpdate`, `serverTime`) nunca são alterados; `geradoEm` diz quando o payload foi montado.

## Review Focus

1. Dois usuários da mesma empresa com papéis diferentes recebem o mesmo `/stock/map`? Hoje sim: `StockService.map(tenantId)` → `mapPoints(tenantId)` só filtra por tenant e a rota não tem `RolesGuard` (`stock.controller.ts:65-72`). A chave por tenant é equivalente. Task A testa tenant ≠ tenant e usuário ≠ usuário do mesmo tenant.
2. Operador que valida, associa, desvincula ou importa um item precisa ver o mapa novo no próximo refresh — Task A testa invalidação em todas as escritas de `StockItem` e que uma montagem iniciada **antes** da invalidação não grava por cima.
3. Resposta HTTP antiga chegando depois de um lote do WebSocket não pode rebobinar a posição — Task C testa `mesclarPosicoes` mantendo a mais nova por `serverTime`.
4. Aba do painel com build antigo (sem `If-None-Match`) continua recebendo 200 com corpo — Task B testa cliente sem condição de cache.
5. Mapa do estoque com cluster preserva busca por IMEI, seleção múltipla, popups, contagens e os marcados sempre visíveis — Task D testa seleção fora do viewport e render de todos os IMEIs buscados.

---

## Ordem e dependências

| Ordem | Task | Camada | Flag | Ataca | Ganho esperado (base: relatório §4) |
|---|---|---|---|---|---|
| A | `/stock/map` com cache single-flight por tenant | backend | `STOCK_MAP_CACHE_MS` | causa 1 | 59 montagens/min → ≤ 6/min; some a fila de 6–29 s |
| B | Frota do painel montada 1× por tenant/2 s + `ETag`/304 | backend | `FROTA_PAINEL_CACHE_MS` | causa 2 | ~450 ms → < 20 ms de CPU por `/traccar/devices` |
| C | Polling do painel como contingência do WebSocket | frontend | `NEXT_PUBLIC_POLLING_MODE` | causa 2 | 10.590 → ~700 chamadas/dia do escritório |
| D | Cluster no mapa do estoque + render só quando o payload muda | frontend | `NEXT_PUBLIC_STOCK_MAP_CLUSTER` | causa 3 | 13,8 s → < 1 s de trava em 90 s |
| E | Propostas (documento): índices de `alerts`, regra de alertas, `/app/vehicles`, retenção | docs | — | causas 4–6 | nenhuma execução |

A e B no mesmo deploy de backend (quando autorizado); C e D no mesmo deploy de frontend. B depende de A só pelo `CacheCompartilhado`. D usa `geradoEm` de A se existir (opcional).

---

### Task A: `/stock/map` montado uma vez por tenant, com single-flight, versão e invalidação

**Files:**
- Create: `backend/src/common/cache/cache-compartilhado.ts`
- Create: `backend/src/common/cache/cache-compartilhado.spec.ts`
- Modify: `backend/src/modules/stock/stock-traccar.service.ts` (`mapPoints` → wrapper; corpo atual vira `montarMapPoints`; `StockMapResult` ganha `geradoEm`)
- Modify: `backend/src/modules/stock/stock.service.ts` (chamar `invalidarMapa(tenantId)` após cada escrita em `StockItem`: linhas ~279, 680, 876, 924, 926, 1225, 1526, 1563, 1679, 1801, 1805 — conferir com `grep -n "stockItem\.\(update\|create\|delete\|updateMany\|upsert\)("`)
- Modify: `backend/src/modules/stock/stock-traccar.service.ts:88,352` (`ensureDevice`, `adotarDesconhecidos` também escrevem)
- Modify: `frontend/dashboard/src/types/stock.ts` (`StockMapResult.geradoEm?: string`)
- Test: `backend/src/modules/stock/stock-traccar.service.spec.ts` (criar ou estender), `backend/src/modules/stock/stock-map.perf.spec.ts` (sintético, 10 k devices)

**Interfaces:**
- Produces `CacheCompartilhado<T>`:
  ```ts
  export interface OpcoesCacheCompartilhado { maxEntradas: number; timeoutMs: number }
  export class CacheCompartilhado<T> {
    constructor(opcoes: OpcoesCacheCompartilhado);
    /** ttlMs pode depender do valor montado (ex.: resultado degradado dura menos). */
    obter(chave: string, ttlMs: number | ((valor: T) => number), montar: () => Promise<T>): Promise<T>;
    /** Sobe a versão da chave: a entrada vigente deixa de ser fresca e uma montagem em voo iniciada antes NÃO é gravada ao terminar (mas ainda é entregue a quem já esperava por ela). */
    invalidar(chave: string): void;
    tamanho(): number;
  }
  ```
  Regras: entrada fresca (idade < ttl **e** versão igual) → devolve o valor sem montar; montagem em voo da versão vigente → devolve a mesma Promise; senão inicia `montar()` dentro de `Promise.race` com `timeoutMs` (estouro → rejeita com `Error('cache: montagem excedeu <ms> ms')` e descarta a promessa em voo); erro **não** é gravado; grava só se a versão não mudou; LRU por `Map` (reinsere ao ler) com despejo da mais antiga acima de `maxEntradas`.
- Produces em `StockTraccarService`: `mapPoints(tenantId)` com o mesmo contrato + `geradoEm: string` (ISO); `invalidarMapa(tenantId: string): void`; `private montarMapPoints(tenantId)`; TTL: `STOCK_MAP_CACHE_MS` (env, inteiro, `0`/ausente = desligado → chama `montarMapPoints` direto), resultado `indisponivel: true` dura `min(ttl, 3_000)`; `timeoutMs = 30_000` (igual ao axios do Traccar); `maxEntradas = 50`.
- Produces em `StockService`: cada método que escreve em `StockItem` termina com `this.stockTraccar.invalidarMapa(tenantId)` (dentro do mesmo `tenantId` da escrita; em transações, depois do commit).

- [ ] **Step 1: Testes que falham — `cache-compartilhado.spec.ts`**
  - `obter` com 20 chamadas simultâneas da mesma chave executa `montar` 1× e todas recebem o mesmo valor
  - chaves diferentes montam separadamente
  - depois do ttl monta de novo; ttl por função (`(v) => v.ok ? 10_000 : 3_000`)
  - `invalidar` → próxima `obter` monta de novo
  - montagem iniciada antes de `invalidar` termina, é entregue a quem esperava, **não** fica gravada (próxima chamada monta)
  - erro de `montar` rejeita todos os que esperavam e não fica gravado
  - estouro de `timeoutMs` rejeita e a chamada seguinte monta de novo
  - `maxEntradas: 2` com 3 chaves despeja a menos recente
- [ ] **Step 2: Rodar e ver falhar** — `cd backend && npx jest cache-compartilhado` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar `cache-compartilhado.ts`.** - [ ] **Step 4: Passar.** - [ ] **Step 5: Commit** `perf(cache): cache compartilhado com single-flight, versao e limite de entradas`.
- [ ] **Step 6: Testes que falham — `stock-traccar.service.spec.ts`** (mocks de `PrismaService`, `TraccarService`, `ReverseGeocodeService`; sem rede):
  - com `STOCK_MAP_CACHE_MS=10000`: 10 `mapPoints('t1')` simultâneos → `traccar.getDevices` 1×; `mapPoints('t2')` monta de novo (tenant isolado); o resultado traz `geradoEm` ISO
  - com `STOCK_MAP_CACHE_MS` ausente: 3 chamadas → 3 montagens (caminho de hoje) e **o payload é igual** ao de antes exceto `geradoEm`
  - Traccar lançando erro → `{ indisponivel: true, pontos: tags }` e a chamada 4 s depois monta de novo
  - `invalidarMapa('t1')` entre duas chamadas → 2 montagens
  - `invalidarMapa` só do t1 não afeta t2
- [ ] **Step 7: Rodar e ver falhar.** - [ ] **Step 8: Implementar** (`mapPoints` wrapper, `montarMapPoints`, `invalidarMapa`, `geradoEm`, leitura da env no construtor com `Number.parseInt` e `Number.isFinite`). - [ ] **Step 9: Passar.** - [ ] **Step 10: Commit** `perf(estoque): /stock/map montado uma vez por tenant com single-flight e invalidacao`.
- [ ] **Step 11: Invalidação nas escritas** — teste em `stock.service.spec.ts` (existe? senão criar mínimo com mocks) para 3 escritas representativas (validar, associar, importar) → `invalidarMapa` chamado com o tenant certo; implementar em todas as escritas listadas em Files; `npx jest stock` verde; commit `perf(estoque): invalida o cache do mapa em toda escrita de StockItem`.
- [ ] **Step 12: Medição sintética — `stock-map.perf.spec.ts`**: 10.428 devices e 8.865 posições sintéticos (gerador determinístico com seed), 9.386 itens de estoque mockados; 60 chamadas em 10 s (6/s, igual à rajada medida) com cache desligado × ligado: registrar no relatório da task `montagens`, tempo total de CPU (`process.cpuUsage()`), p50/p95 de latência por chamada. Critério: ligado → ≤ 2 montagens, p95 < 50 ms nas chamadas que acertam o cache. **Qualificar**: é CPU do processo de teste com mocks, não o custo do Traccar nem do Postgres.
- [ ] **Step 13: `npm run lint` e `npm run build` no backend sem erro novo; commit** `test(estoque): medicao sintetica do cache do mapa`.

**Reversão:** env `STOCK_MAP_CACHE_MS` ausente = caminho de hoje. Código: redeploy da tag anterior.

---

### Task B: Frota do painel montada 1× por tenant a cada 2 s, com `ETag` forte e `304`

**Files:**
- Create: `backend/src/modules/traccar/frota-painel.service.ts` (+ `.spec.ts`)
- Modify: `backend/src/modules/traccar/traccar.controller.ts:25-65` (`getDevices`, `getPositions`)
- Modify: `backend/src/modules/traccar/traccar.module.ts` (provider)
- Test: `backend/src/modules/traccar/traccar.controller.spec.ts` (criar ou estender)

**Interfaces:**
- Consumes: `CacheCompartilhado` (Task A), `TraccarService.getDevices()/getPositions()` (coalesce de 2 s já existente), `PrismaService.vehicle.findMany`.
- Produces `FrotaPainelService`:
  ```ts
  export interface FrotaPainel { devices: TraccarDevice[]; positions: TraccarPosition[]; etagDevices: string; etagPositions: string; geradoEm: number }
  frotaDoTenant(tenantId: string): Promise<FrotaPainel>   // cache por `frota:${tenantId}`, ttl FROTA_PAINEL_CACHE_MS, timeout 30 s, maxEntradas 50
  ```
  Montagem: `vehicle.findMany({ where: { tenantId, traccarDeviceId: { not: null }, deletedAt: null }, select: { traccarDeviceId: true } })` → `Set<number>` → `getDevices()` e `getPositions()` em `Promise.all` → filtro por `Set.has` (mesmo resultado do `includes` de hoje, mesma ordem). `etag = 'W/' + '"' + sha1(JSON.stringify(lista)).slice(0, 20) + '"'` — **weak**, calculado 1× por montagem. Lista vazia → `[]` com etag próprio (igual a hoje: `[]`).
- Produces no controller: com `FROTA_PAINEL_CACHE_MS > 0`: `@Headers('if-none-match') inm`, `@Res({ passthrough: true }) res`; `res.setHeader('ETag', etag)`; `res.setHeader('Cache-Control', 'private, no-cache')`; se `inm` contém o etag (comparação por lista separada por vírgula, ignorando `W/`) → `res.status(304)` e `return undefined`; senão `return lista`. Com a flag desligada: caminho de hoje **intacto** (sem cabeçalhos novos). `GET positions/:deviceId/history` não muda.

- [ ] **Step 1: Testes que falham — `frota-painel.service.spec.ts`**: 10 chamadas simultâneas → 1 `vehicle.findMany` e 1 `getDevices`; tenants diferentes → etags diferentes e listas corretas; a lista filtrada é **igual** (deep-equal e mesma ordem) à do algoritmo antigo (`deviceIds.includes`) para 3 conjuntos aleatórios com seed; mudar uma posição → etag muda; mesma frota → etag igual; flag `0` → `frotaDoTenant` monta a cada chamada.
- [ ] **Step 2–4: falhar, implementar, passar; commit** `perf(traccar): frota do painel montada uma vez por tenant com etag`.
- [ ] **Step 5: Testes que falham — `traccar.controller.spec.ts`** (service mockado): sem `If-None-Match` → 200 com corpo e `ETag`; `If-None-Match` igual → status 304 e retorno `undefined`; `If-None-Match` de outro tenant → 200; cabeçalho `Cache-Control: private, no-cache`; flag desligada → sem `ETag` setado pelo controller e corpo igual ao de hoje.
- [ ] **Step 6–8: falhar, implementar, passar; lint; build; commit** `perf(traccar): /traccar/devices e /traccar/positions respondem 304 por etag`.
- [ ] **Step 9: Prova de comportamento do Express com 304 + envelope** — teste com `supertest` se disponível (`ls node_modules/supertest`); senão, teste de integração leve subindo um `NestApplication` só com `TraccarController` + `TransformInterceptor` e `fetch` local em porta efêmera: `If-None-Match` correto → `304` **sem corpo** e sem `Content-Length` > 0. Registrar o resultado no relatório da task. (Mission §6-B: "não presuma que todo consumidor recebe um 304 diretamente" — o navegador recebe 304 e entrega ao axios o corpo em cache; isto já acontece hoje em `/vehicles`, 304 no access log.)
- [ ] **Step 10: Medição sintética** (mesmo gerador da Task A): 100 chamadas de `getDevices` em 10 s com flag desligada × ligada: CPU do processo e `getDevices` do Traccar chamadas; critério: ligada → ≤ 6 montagens em 10 s, CPU/chamada < 10 % da desligada. Qualificar como sintético.

**Reversão:** env `FROTA_PAINEL_CACHE_MS` ausente = caminho de hoje.

---

### Task C: Polling do painel como contingência do WebSocket (modo `contingencia`, padrão `legado`)

**Files:**
- Create: `frontend/dashboard/src/lib/tracking-polling.ts` (+ `tracking-polling.test.ts`)
- Create: `frontend/dashboard/jest.config.cjs` (ts-jest, `testEnvironment: node`, `testMatch: ['<rootDir>/src/**/*.test.ts']`, `moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' }`) e script `"test": "jest"` em `frontend/dashboard/package.json` (**só scripts, nenhuma dependência nova** — jest e ts-jest estão hoisted na raiz)
- Modify: `frontend/dashboard/src/contexts/tracking-context.tsx:249-297` (polling) e `:361-369` (socket)
- Modify: `frontend/dashboard/src/hooks/use-traccar-socket.ts` (`onReconnect`)

**Interfaces:**
- `tracking-polling.ts`:
  ```ts
  export type ModoPolling = 'legado' | 'contingencia';
  export const MODO_POLLING: ModoPolling; // process.env.NEXT_PUBLIC_POLLING_MODE === 'contingencia' ? 'contingencia' : 'legado'
  export const POLL_MS = 8_000;            // tique do timer (igual a hoje)
  export const RECONCILIA_MS = 60_000;     // frota completa com socket vivo
  export const VEHICLES_MS = 32_000;       // lista de veículos (igual a hoje: a cada 4 tiques)
  export const SOCKET_MUDO_MS = 90_000;    // > pingInterval 25 s + pingTimeout 20 s do socket.io: socket "conectado" sem nenhum lote há 90 s é tratado como degradado
  export interface EstadoPolling { modo: ModoPolling; agora: number; socketConectado: boolean; ultimoLoteEm: number | null; ultimaFrotaEm: number; ultimosVehiclesEm: number }
  export function decidirPolling(e: EstadoPolling): { frota: boolean; vehicles: boolean; motivo: 'legado' | 'socket-fora' | 'socket-mudo' | 'reconciliacao' | 'nada' }
  export function mesclarPosicoes(anterior: Map<number, TraccarPosition>, novas: TraccarPosition[]): Map<number, TraccarPosition>  // conjunto = novas; para cada deviceId presente nas duas, fica a de serverTime (ou fixTime, ou id) maior
  export function mesclarDevices(anterior: Map<number, TraccarDevice>, novos: TraccarDevice[]): Map<number, TraccarDevice>       // idem por lastUpdate
  ```
  `decidirPolling`: `legado` → frota a cada tique (como hoje), vehicles quando `agora - ultimosVehiclesEm >= VEHICLES_MS`; `contingencia` → frota se `!socketConectado` **ou** (`ultimoLoteEm !== null && agora - ultimoLoteEm > SOCKET_MUDO_MS`) **ou** `agora - ultimaFrotaEm >= RECONCILIA_MS`; vehicles igual ao legado (32 s, inalterado).
- `use-traccar-socket.ts`: nova opção `onReconnect?: () => void`, chamada no evento `connect` **somente** quando já houve uma conexão anterior nesta instância.
- `tracking-context.tsx`: o timer de 8 s chama `decidirPolling` com refs (`isConnected`, `ultimoLoteEm` atualizado em `handlePositionsBatch`); `setPositionMap(prev => mesclarPosicoes(prev, positions))` e `setDeviceMap(prev => mesclarDevices(prev, devices))` no polling (nos dois modos — é proteção contra resposta antiga, não muda o que a tela mostra); `onReconnect` → `poll()` imediato com frota + vehicles; `visibilitychange` mantido; carregamento inicial mantido.

- [ ] **Step 1: Testes que falham — `tracking-polling.test.ts`** (timers não são necessários: funções puras com `agora` explícito): legado → `frota: true` sempre; contingência com socket conectado e lote há 1 s e frota há 10 s → `nada`; socket fora → `socket-fora`; conectado mas lote há 91 s → `socket-mudo`; conectado, lote há 1 s, frota há 61 s → `reconciliacao`; vehicles a cada 32 s nos dois modos; `mesclarPosicoes` mantém a mais nova e remove quem saiu; `mesclarDevices` idem.
- [ ] **Step 2: Rodar e ver falhar** — `cd frontend/dashboard && npx jest` → FAIL.
- [ ] **Step 3–4: implementar `tracking-polling.ts` e o `jest.config.cjs`; passar; commit** `perf(painel): regras de polling como contingencia do websocket (puras)`.
- [ ] **Step 5: Ligar no contexto e no hook** (sem teste de componente: não há runner de DOM; a cobertura é das regras puras + verificação em navegador no Step 7). `npm run lint` e `npm run build` (com `NEXT_PUBLIC_POLLING_MODE` ausente e com `=contingencia`) sem erro. Commit `perf(painel): polling de frota so como contingencia do websocket, com reload ao reconectar`.
- [ ] **Step 6: Comparação REST × WebSocket, campo a campo**, registrada no relatório da task: `/traccar/positions` devolve `TraccarPosition[]` do Traccar filtrado por tenant **sem** o portão de qualidade; `positions:batch` só traz posições aprovadas por `assessPosition` (`traccar.gateway.ts:392-396`) e só de devices em `deviceTenantMap` (refresh a cada 2 min, `:226`); `devices:batch` idem; vínculos novos, remoções e permissões só chegam por `/vehicles` (32 s) e pela reconciliação (60 s). Concluir: o que o modo contingência deixa de cobrir em relação ao legado e com que atraso máximo.
- [ ] **Step 7: Verificação em navegador (só leitura, 1 aba, token temporário de 10 min assinado no container como em `reference_validacao_visual_prod_token`)**: `next dev` na worktree com `NEXT_PUBLIC_API_URL=https://api.trackgo.site NEXT_PUBLIC_WS_URL=https://api.trackgo.site NEXT_PUBLIC_POLLING_MODE=contingencia`; script `scratchpad/medir-estoque-mapa.js` adaptado para `http://localhost:3000/tecnicos`, 120 s: `/traccar/positions` ≤ 2 chamadas (era 8 em 60 s), lotes chegando (contar `positions:batch` via console), posições na tela atualizando. Depois o mesmo com o modo legado: 15 chamadas em 120 s (prova de que a flag separa os dois). Registrar números.

**Reversão:** build sem a env = legado.

---

### Task D: Cluster no mapa do estoque e render só quando o payload muda

**Files:**
- Create: `frontend/dashboard/src/lib/stock-cluster.ts` (+ `stock-cluster.test.ts`)
- Modify: `frontend/dashboard/src/components/stock/stock-map-container.tsx`
- Modify: `frontend/dashboard/src/app/(dashboard)/estoque/mapa/page.tsx:92-105` (`carregar`: ignorar payload com o mesmo `geradoEm` do anterior quando o campo existir)
- Reference (ler inteiro antes): `frontend/dashboard/src/components/map/map-container.tsx` — implementação com `supercluster` de `206709d`

**Interfaces:**
- `stock-cluster.ts`:
  ```ts
  export const CLUSTER_ATIVO: boolean; // process.env.NEXT_PUBLIC_STOCK_MAP_CLUSTER === 'on'
  export function indexarPontos(pontos: StockMapPoint[]): Supercluster;            // só pontos com latitude/longitude; radius/maxZoom iguais aos do mapa principal
  export function itensVisiveis(index: Supercluster, bbox: [number, number, number, number], zoom: number, fixos: Set<string>): { clusters: ClusterVisivel[]; pontos: StockMapPoint[] }  // `fixos` (selecionados/buscados) sempre saem como pontos individuais, mesmo fora do bbox
  ```
- `stock-map-container.tsx`: com `CLUSTER_ATIVO` → marcadores só do que `itensVisiveis` devolver, redesenho em `moveend`/`zoomend`, clique em cluster dá zoom; com a flag desligada → comportamento de hoje intacto. API pública (`StockMapRef`, props) inalterada.

- [ ] **Step 1: Testes que falham — `stock-cluster.test.ts`**: 9.000 pontos no mesmo bairro em zoom 10 → ≤ 50 itens visíveis; os `fixos` fora do bbox aparecem como pontos; pontos sem coordenada não entram; zoom 18 → pontos individuais.
- [ ] **Step 2–4: falhar, implementar, passar; commit** `perf(estoque): indice de cluster do mapa do estoque (puro)`.
- [ ] **Step 5: Ligar no container e na página** (flag), lint, build; commit `perf(estoque): cluster no mapa do estoque e render so quando o payload muda`.
- [ ] **Step 6: Verificação em navegador** (mesmo método da Task C, 90 s em `/estoque/mapa`, flag `on` × `off`): long tasks total e máximo, nós de marcador no DOM, memória (`performance.memory` se disponível), busca por IMEI e seleção funcionando com cluster. Meta: total < 1.000 ms e máx. < 200 ms em 90 s (era 13.776 / 2.835).

**Reversão:** build sem a env = sem cluster.

---

### Task E: Propostas (documento, sem execução) — índices, alertas, app do associado, retenção

**Files:** Create `docs/superpowers/plans/2026-10-14-propostas-banco-alertas-app-retencao.md`.

Conteúdo obrigatório, com base no relatório §4.5 e §2 (causas 4–6) e na missão §8:
- **Índices de `alerts`**: consultas reais e planos (`EXPLAIN` já colhidos), índices existentes, DDL `CREATE INDEX CONCURRENTLY IF NOT EXISTS` com tamanho estimado, acompanhamento (`pg_stat_progress_create_index`), tratamento de índice `INVALID`, janela sugerida, registro no Prisma (`prisma migrate resolve --applied`). **Não executar.**
- **Alertas**: separar (1) evitar duplicação de alertas novos, (2) mudar a regra de repetição, (3) tratar os 2.910.089 abertos — com dependências explícitas (por que (3) não é pré-requisito de (1)), impactos para quem consome `alert:new` (grep no painel, app e dispatcher), e perguntas de negócio.
- **App do associado**: contrato real de visibilidade de `/app/vehicles` (ler `app-data.service.ts` e as regras de proprietário/compartilhamento), proposta de consulta por device sem perder nenhum caso legítimo, testes de autorização.
- **Retenção**: por tabela (`positions`, `tc_positions`, `tag_positions`, `alerts`, `alert_history`, log do Traccar): o que depende de cada uma (última posição, histórico, relatórios, restauração), opções de prazo com GB liberados por opção, risco e reversibilidade. **Sem escolher prazo.**

- [ ] Escrever; commit `docs(perf): propostas separadas de indices, alertas, app e retencao`.

---

## Critérios de aceitação (ambiente isolado, sintético) e o que fica pendente para produção

| Critério | Como se prova aqui | Pendente em produção |
|---|---|---|
| 1 montagem simultânea por chave | specs de `CacheCompartilhado`, `mapPoints`, `frotaDoTenant` | observar `montagens/min` no log (Task A/B logam 1 linha por montagem em nível debug) |
| Acerto de cache sem reprocessar | spec sintético: p95 < 50 ms no acerto | OPTIONS > 2 s por hora = 0 no pico |
| Redução de chamadas | Task C Step 7 (1 aba: 8 → ≤ 2 em 60 s) | `/traccar/positions` do escritório ≤ 60/h |
| Latência sob carga | spec sintético 6/s × 10 s | `/app/alerts` p99 < 500 ms às 17–18 h UTC |
| Dados dentro do limite | TTLs: 10 s e 2 s; `geradoEm` no payload | — |
| Sem regressão de permissão | specs tenant ≠ tenant; sem `RolesGuard` novo | — |
| Memória estável | `maxEntradas` + spec de despejo; teste de 10 min no bench com `process.memoryUsage()` | RSS do backend em 24 h |
| Travadas do mapa | Task D Step 6 | medição no escritório |

## Publicação (só depois de autorização expressa) — rascunho

1. Backend primeiro (A+B com envs ausentes = desligado) → `/health` 200 → ligar `STOCK_MAP_CACHE_MS=10000` (reinício ~20 s) → observar 1 h no pico → ligar `FROTA_PAINEL_CACHE_MS=2000` → observar.
2. Frontend depois (C+D com envs ausentes = legado) → ligar `NEXT_PUBLIC_POLLING_MODE=contingencia` num build → observar → `NEXT_PUBLIC_STOCK_MAP_CLUSTER=on`.
3. Rollback: tags anteriores no registry (`r21go-backend:b366657`, `r21go-frontend:206709d`); desligar = env + reinício, **não é instantâneo**.
4. Critérios de interrupção: qualquer 5xx novo, `/health` `db.ok=false`, posições paradas (`tc_positions` 2 min = 0), reclamação de dado errado/permissão.
