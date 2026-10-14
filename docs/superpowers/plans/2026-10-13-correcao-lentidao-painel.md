# Correção da lentidão do painel — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar do thread único do backend o trabalho repetido que o painel do escritório dispara (mapa do estoque e frota montados por aba, por chamada), e as cargas de fundo medidas em 13/10/2026, sem mudar o que o operador vê.

**Architecture:** Payloads iguais para todas as abas do tenant (`/stock/map`, `/traccar/devices`, `/traccar/positions`) passam a ser montados **uma vez** por janela e servidos do cache (com coalesce de chamadas simultâneas e `ETag`/304). O painel usa o WebSocket (que já entrega lote de 1 s) como fonte principal e o polling só como fallback. O mapa do estoque ganha o mesmo cluster do mapa principal. Alertas ganham índice e param de ser criados 48×/dia por veículo parado. Postgres só depois de remedir.

**Tech Stack:** Next.js 16 / React 19 (dashboard), NestJS 11 + Prisma 7 (backend), Postgres 17, socket.io, Traefik, `supercluster` (já no dashboard).

**Spec:** `docs/research/2026-10-13-investigacao-lentidao-causa-raiz.md` — seções 1, 2 e 4 trazem todos os números; cada task cita a causa que ataca.

**Ponto de partida obrigatório:** branch nova a partir do que está em produção (`b366657` backend / `206709d` frontend), não da branch local `fix/estoque-ignicao-pacote` (HEAD `b11a08b` não contém `cb6c319`/`364ab31`). Conferir: `git merge-base --is-ancestor cb6c319 HEAD && git merge-base --is-ancestor 232097c HEAD && echo ok`.

## Global Constraints

- Deploy: baseline antes (`trackgo.site`, `api.trackgo.site/api/v1/health`, `traccar.trackgo.site/api/server` = 200) e verificação depois (os 3 + `SELECT count(*) FROM tc_positions WHERE servertime > now() - interval '2 minutes'` > 0). Um serviço por vez, via registry `localhost:5000`, `docker builder prune -f` entre builds, `GIT_SHA` reaplicado (ver `reference_deploy_producao_armadilhas`). Conferir `ps -eo cmd | grep "[d]ocker build"` antes (outra sessão pode estar buildando).
- Banco: só aditivo, `CONCURRENTLY`, `IF NOT EXISTS`/`IF EXISTS`; migration registrada no repositório e aplicada **antes** do código (o backend não migra no boot). `DROP INDEX CONCURRENTLY` não roda em transação: registrar com `prisma migrate resolve --applied`.
- Multi-tenant: toda chave de cache e toda query levam `tenantId`.
- Medição antes/depois com os **mesmos** scripts do relatório, no **mesmo** horário (14h–18h BRT): `/tmp/agg.awk`, `/tmp/pct.awk`, `/tmp/hora2.awk`, `/tmp/rate.sh` no droplet; `ws-check.js`; `scratchpad/medir-estoque-mapa.js` (puppeteer). Salvar a coleta "antes" em `/tmp/acc-antes-<task>.log` no dia do deploy.
- Rollback de código = redeploy da tag anterior do registry (`r21go-backend:b366657`, `r21go-frontend:206709d`), sem migration reversa.

## Review Focus

1. Operador valida/associa/desvincula um item no mapa do estoque e precisa ver o resultado no próximo refresh, não 30 s depois — Task 1 testa invalidação do cache na escrita.
2. Painel com WebSocket caído > 30 s continua recebendo posições (fallback) e, ao reconectar, recarrega o que perdeu — Task 3 testa `isConnected=false` → polling e `connect` → reload completo.
3. Payload em cache nunca cruza tenant — Tasks 1 e 2 testam `t1` × `t2`.
4. Status calculados por tempo (ONLINE 30 min, S/RESP, OFFLINE 72 h) seguem mudando sem recarga — Task 3 confirma que o relógio de 60 s do contexto (`tracking-context.tsx:376`) continua acionando o recálculo.
5. Veículo que volta online e cai de novo gera OFFLINE novo; veículo que oscila a cada minuto não gera 1 alerta por minuto — Task 6 testa os dois casos.

---

## Ordem, dependências e ganho esperado

| Ordem | Task | Camada | Risco | Ataca | Ganho esperado |
|---|---|---|---|---|---|
| 1 | Cache + coalesce de `/stock/map` por tenant | backend | baixo | causa 1 | 59 montagens/min → 4/min; some a fila de 6–29 s |
| 2 | Payload de frota (`/traccar/devices`, `/traccar/positions`) montado 1×/s por tenant + `ETag` 304 | backend | baixo | causa 2 | 450 ms → ~0 ms de CPU por `/traccar/devices` |
| 3 | Polling do painel só como fallback + reload ao reconectar | frontend | médio | causa 2 | 10.590 → ~700 chamadas/dia do escritório |
| 4 | Cluster no mapa do estoque + não refazer marcadores sem mudança | frontend | baixo | causa 3 | 13,8 s → < 1 s de trava em 90 s |
| 5 | Índices de `alerts` (dedup e não lidos) | banco | baixo | causa 4 | seq scan de 700 MB 6×/min → index scan |
| 6 | Alertas de estado: um aberto por veículo (com limpeza prévia) e IGNITION fora do `alert:new` | backend + dado | **alto** (dado) | causa 4 | 230 mil → ≤ 40 mil alertas/dia; 7 → < 1 `alert:new`/s |
| 7 | `/app/vehicles` só com devices do associado | backend | baixo | causa 2 (app) | 12,7 downloads de frota/min a menos |
| 8 | Postgres: remedir hit; `shared_buffers`; índices mortos (sem o UNIQUE) | banco | médio | causa 5 | só se a remedição justificar |

Tasks 1+2 num deploy do backend; 3+4 num deploy do frontend; 5 antes de 6; 6 só com OK do dono; 7 quando sobrar; 8 em janela própria, depois de 5.

---

### Task 1: `/stock/map` montado uma vez por tenant a cada 15 s

**Files:**
- Modify: `backend/src/modules/stock/stock-traccar.service.ts` (`mapPoints`)
- Modify: `backend/src/modules/stock/stock.service.ts` (validar / associar / desvincular / atualizar-tag → invalidar)
- Reuse/extend: `backend/src/common/cache/ttl-cache.ts` (já usado em `dashboard.service.ts:33`)
- Test: `backend/src/modules/stock/stock-traccar.service.spec.ts`, `backend/src/common/cache/ttl-cache.spec.ts`

**Interfaces:**
- Produces em `ttl-cache.ts`: `getOrSet<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>` — chamadas simultâneas com a mesma `key` compartilham a mesma Promise (coalesce, como `frotaCompartilhada` em `traccar.service.ts:224`); `invalidate(prefix: string): void`.
- Produces em `stock-traccar.service.ts`: `mapPoints(tenantId: string): Promise<StockMapResult>` com contrato idêntico; internamente `cache.getOrSet(\`stock-map:${tenantId}\`, MAP_CACHE_MS, () => this.montarMapPoints(tenantId))`, `MAP_CACHE_MS = 15_000`; `invalidarMapa(tenantId)` chamado por toda escrita em `StockItem` do tenant.

- [ ] **Step 1: Testes que falham**

```ts
// ttl-cache.spec.ts
it('getOrSet com chamadas simultâneas executa fn uma vez', async () => { /* 5 × getOrSet('k', 1000, spy) em Promise.all → spy 1× */ });
it('getOrSet refaz depois do ttl', …); it('invalidate("stock-map:t1") força nova montagem', …);
// stock-traccar.service.spec.ts
it('duas chamadas de mapPoints no mesmo segundo montam uma vez', …);
it('tenants diferentes não compartilham', …);
it('validar item invalida o cache do tenant', …);
```

- [ ] **Step 2: Rodar e ver falhar** — `cd backend && npx jest ttl-cache stock-traccar` → FAIL.
- [ ] **Step 3: Implementar** conforme Interfaces. Corpo atual de `mapPoints` vira `private montarMapPoints`. `invalidarMapa` nos pontos de escrita de `stock.service.ts` (grep `stockItem.update|create|delete` nesse arquivo).
- [ ] **Step 4: Rodar e ver passar; `npm run lint`; `npm run build`.**
- [ ] **Step 5: Verificação em produção:** direto no origin (token temporário), `/stock/map` 3× em 2 s → 1ª 1,0–1,5 s, 2ª/3ª < 50 ms. Dia seguinte 14–18h: `/stock/map` do escritório com p95 < 1 s; OPTIONS > 2 s por hora = 0; `/app/alerts` p99 < 500 ms às 17–18h UTC.
- [ ] **Step 6: Commit** — `git commit -m "perf(estoque): /stock/map montado uma vez por tenant a cada 15 s, com coalesce e invalidacao na escrita"`

---

### Task 2: Payload de frota do painel montado 1×/s por tenant, com `ETag`

**Files:**
- Modify: `backend/src/modules/traccar/traccar.controller.ts:29-70` (`getDevices`, `getPositions`)
- Modify: `backend/src/modules/traccar/traccar.service.ts` (`frotaCompartilhada`, `FROTA_CACHE_MS`)
- Test: `backend/src/modules/traccar/traccar.controller.spec.ts`

**Interfaces:**
- Produces: `TraccarService.frotaDoTenant(tenantId: string): Promise<{ devices: Buffer; positions: Buffer; etag: string; geradoEm: number }>` — monta o JSON **já serializado** (Buffer) uma vez por `FROTA_PAINEL_MS = 1_000` por tenant, com coalesce; `etag` = hash curto do conteúdo. Controller: se `If-None-Match === etag` → 304; senão `res.setHeader('ETag', etag)` e envia o Buffer (`Content-Type: application/json`). `FROTA_CACHE_MS` (coalesce do Traccar) sobe de 2.000 para 5.000.

- [ ] **Step 1: Testes que falham** — `it('duas chamadas de /traccar/devices no mesmo segundo serializam uma vez')`, `it('If-None-Match igual devolve 304 sem corpo')`, `it('tenant t2 não recebe buffer de t1')`.
- [ ] **Step 2: Falhar.** - [ ] **Step 3: Implementar.** - [ ] **Step 4: Passar, lint, build.**
- [ ] **Step 5: Verificação em produção:** CPU por chamada (método do relatório §4.2, `/proc/<pid>/stat`, 5 chamadas espaçadas): `/traccar/devices` de ~450 ms para < 50 ms. Access log: `/traccar/devices` com status 304 > 50 % das chamadas do escritório.
- [ ] **Step 6: Commit** — `git commit -m "perf(traccar): frota do painel serializada uma vez por segundo por tenant, com ETag"`

---

### Task 3: Polling do painel só como fallback; reload completo ao reconectar

**Files:**
- Modify: `frontend/dashboard/src/contexts/tracking-context.tsx:250-300`
- Modify: `frontend/dashboard/src/hooks/use-traccar-socket.ts` (expor `onReconnect`)
- Test: `frontend/dashboard/src/contexts/__tests__/tracking-context-polling.test.tsx`

**Interfaces:**
- Consumes: `useTraccarSocket({ …, onReconnect?: () => void })` → `{ isConnected, disconnect }`.
- Produces: constantes exportadas `POLL_FALLBACK_MS = 8_000`, `BATCH_STALE_MS = 30_000`, `RECONCILE_MS = 120_000`. Regra: `poll()` a cada 8 s roda **somente** se `!isConnected || Date.now() - ultimoBatchEm > BATCH_STALE_MS`; com socket vivo, reconciliação completa a cada 120 s; no evento `connect` após queda, `loadAll()` imediato. O relógio de 60 s (`:376`) que recalcula status por tempo não muda. Requisição de frota em voo não é duplicada (`emVoo` ref).

- [ ] **Step 1: Testes que falham** (timers falsos):
  - socket vivo + lote a cada 1 s, 40 s → `getPositions` 0×;
  - socket morto, 24 s → 3×;
  - socket vivo sem lote por 30 s → 1×;
  - `connect` após `disconnect` → `loadAll` 1× imediato;
  - 250 s com socket vivo → reconciliação 2×.
- [ ] **Step 2: Falhar.** - [ ] **Step 3: Implementar** (manter `document.hidden`/`visibilitychange`). - [ ] **Step 4: Passar, lint.**
- [ ] **Step 5: Verificação em produção:** `medir-estoque-mapa.js` em `/tecnicos` 60 s: `/traccar/positions` ≤ 1 (era 8). Access log do escritório 1 h: `/traccar/positions` ≤ 60/h (era 1.000+). `ws-check.js` segue com 8 lotes em 8 s.
- [ ] **Step 6: Commit** — `git commit -m "perf(painel): polling de frota so como fallback do websocket, com reload ao reconectar"`

---

### Task 4: Cluster no mapa do estoque e render só quando o payload muda

**Files:**
- Modify: `frontend/dashboard/src/components/stock/stock-map-container.tsx`
- Reference: `frontend/dashboard/src/components/map/map-container.tsx` (implementação de `supercluster` de `206709d` — ler inteira antes)
- Modify: `frontend/dashboard/src/app/(dashboard)/estoque/mapa/page.tsx:92-105` (`carregar`: não chamar `setPontos` se o JSON for igual ao anterior — comparar `etag`/hash)
- Test: `frontend/dashboard/src/components/stock/__tests__/stock-map-cluster.test.tsx`

**Interfaces:**
- Produces: mesma API de `StockMapRef`; marcadores individuais só para o que está no viewport e fora de cluster; `moveend` redesenha. Marcados (`selecionadosIds`) ficam fora do índice, como no mapa principal.

- [ ] **Step 1: Teste que falha** — 9.000 pontos no mesmo bairro → ≤ 50 nós de marcador no DOM; selecionados sempre presentes.
- [ ] **Step 2–4: falhar, implementar, passar, lint.**
- [ ] **Step 5: Verificação em produção:** `medir-estoque-mapa.js` em `/estoque/mapa` 90 s: long tasks total < 1.000 ms, máx. < 200 ms (era 13.776 / 2.835).
- [ ] **Step 6: Commit** — `git commit -m "perf(estoque): cluster no mapa do estoque e render so quando o payload muda"`

---

### Task 5: Índices de `alerts`

**Files:**
- Modify: `backend/prisma/schema.prisma` (model Alert)
- Create: `backend/prisma/migrations/<ts>_indices_alerts_dedup_e_nao_lidos/migration.sql`
- Modify: `backend/src/modules/alerts/alerts.cron.ts:243` (`vehiclesComAlertaRecente` passa a filtrar `tenantId`)

**Interfaces:**
- Produces: `CREATE INDEX CONCURRENTLY IF NOT EXISTS alerts_tenant_id_type_created_at_idx ON alerts (tenant_id, type, created_at DESC);` e `CREATE INDEX CONCURRENTLY IF NOT EXISTS alerts_tenant_id_nao_lidos_idx ON alerts (tenant_id) WHERE read = false;`. `vehiclesComAlertaRecente(type, desde, tenantId)`.

- [ ] **Step 1: Medir antes (produção, leitura):** EXPLAIN do dedup e do `count(*) … read = false` → Seq Scan, ~89 mil blocos.
- [ ] **Step 2: Criar os índices em produção** (sessão própria, `statement_timeout = 0`, fora das 03:00 do backup; se cancelar, `DROP INDEX` do INVALID antes de repetir) e registrar a migration (`IF NOT EXISTS`, no-op lá).
- [ ] **Step 3: Medir depois:** os dois EXPLAIN → Index Scan, < 1.000 blocos, < 20 ms; `rate.sh 120` → `alerts seq_scan` delta 0.
- [ ] **Step 4: Commit** — `git commit -m "perf(alertas): indices para dedup do cron e contador de nao lidos; dedup filtra por tenant"`

---

### Task 6: Alertas de estado com um aberto por veículo (requer limpeza de dado e OK do dono)

**Pré-requisito de dado (decisão do dono):** há 2.910.089 alertas OPEN (1.343.537 OFFLINE em 6.716 veículos, desde 30/04). Com dedup por `status = OPEN`, esses veículos nunca mais gerariam OFFLINE. Antes do deploy: `UPDATE alerts SET status='RESOLVED', resolved_at=now(), resolution='fechamento em lote 2026-10' WHERE status='OPEN' AND created_at < now() - interval '1 day'` em lotes de 50 mil (com backup `pg_dump -t alerts` antes). Isso **altera dado** — só com autorização explícita.

**Files:**
- Modify: `backend/src/modules/alerts/alerts.cron.ts:46-230`
- Modify: `backend/src/modules/alerts/alerts.service.ts:357-426`
- Test: `alerts.cron.spec.ts`, `alerts.service.spec.ts`

**Interfaces:**
- Produces: `vehiclesComAlertaAberto(tenantId, type): Promise<Set<string>>` (`status: 'OPEN'`, usa o índice `(tenant_id, type, status)` — adicionar na Task 5 se esta for aprovada); `AlertsService.resolverAutomatico(tenantId, vehicleId, type)`; `createAlert(..., opts?: { emitirPainel?: boolean })` — IGNITION_ON/OFF grava sem `alert:new`. Oscilação: veículo que volta online só resolve o OFFLINE se ficou ≥ `ESTABILIDADE_MS = 10 min` online (evita ciclo resolver/criar a cada minuto).

- [ ] **Step 1: Levantar quem consome `alert:new` de IGNITION** (grep `IGNITION` em `frontend/dashboard/src`, `mobile/`, `alerts-dispatcher`) e registrar na task. Se o app do associado usa (aviso de chave), manter o emit para a sala do associado.
- [ ] **Step 2: Testes que falham** — veículo offline com OFFLINE aberto não gera outro após 31 min; voltou online 10 min e caiu → resolve e cria novo; oscila a cada 1 min → 1 alerta; IGNITION_ON com `emitirPainel=false` não chama emitter.
- [ ] **Step 3–5: falhar, implementar, passar, lint, build.**
- [ ] **Step 6: Verificação em produção (24 h):** alertas/dia por tipo ≤ 40 mil no total; `ws-check.js` → `alert:new` ≤ 5 em 8 s; tela `/alertas` lista o OFFLINE aberto certo por veículo.
- [ ] **Step 7: Commit** — `git commit -m "fix(alertas): um OFFLINE/GPS_SILENT aberto por veiculo, com estabilidade de 10 min; ignicao nao empurra ao painel"`

---

### Task 7: `/app/vehicles` consulta só os devices do associado

**Files:** `backend/src/modules/app/app-data.service.ts:160-200`; test `app-data.service.spec.ts`.
**Interfaces:** usa `traccarService.getPositions(deviceId)` por device do associado (ou `getPositionsByDeviceIds(ids: number[])` novo, `GET /api/positions?id=a&id=b`); sem `getDevices()` da frota.
- [ ] Teste que falha (`getDevices` não é chamado para associado com 2 veículos) → implementar → passar → verificação (`/app/vehicles` p50 < 150 ms; JSON idêntico para 3 associados) → `git commit -m "perf(app): /app/vehicles consulta so os devices do associado"`.

---

### Task 8: Postgres — remedir e só então mexer

- [ ] **Step 1 (após Task 5, 24 h):** `pg_stat_database` hit de `rastreamento21go`; se > 85 %, **parar aqui** (o seq scan de alerts era o que puxava o hit para 41 %).
- [ ] **Step 2 (só se hit continuar < 85 %):** `shared_buffers = 2GB` via `ALTER SYSTEM` (um `-c` por comando); conferir `MemAvailable` ≥ 4 GB; reinício em janela: `CHECKPOINT;` → `docker service update --stop-grace-period 60s --force rastreamento-21-go_postgres-rastreamento` (ordem já é `stop-first`) → `pg_isready` → `/health` `db.ok` → Traccar gravando (`tc_positions` 2 min > 0; se não, `docker service update --force` no Traccar).
- [ ] **Step 3 (índices mortos, só com ≥ 14 dias de estatística e `git grep -n -E "jamming|powerCut" backend/src | grep -i where` vazio ou coberto por `(vehicle_id, device_time)`):** `DROP INDEX CONCURRENTLY IF EXISTS positions_vehicle_id_jamming_device_time_idx;` depois o `power_cut`; fora das 03:00; conferir `pg_stat_activity` sem transação longa antes. **Nunca** `positions_traccar_position_id_key` (UNIQUE, usado no insert). Registrar com `prisma migrate resolve --applied`. `df -h` antes/depois (−13 GB).
- [ ] **Commit** — `git commit -m "perf(positions): remove indices sem leitura"` (só o Step 3 gera commit).

**Rollback:** `ALTER SYSTEM RESET shared_buffers` + reinício; recriar índice leva horas e precisa de disco — por isso o Step 3 exige as duas confirmações.

---

## Critérios objetivos de sucesso (14h–18h BRT, mesmos scripts)

| Métrica | 13/10 | Meta | Task |
|---|---|---|---|
| OPTIONS > 2 s por hora (todos os IPs) | 47–50 | 0 | 1, 2 |
| `/app/alerts` (304) p99 às 17–18h UTC | 1.887–4.731 ms | < 500 ms | 1, 2 |
| `/stock/map` escritório: chamadas/h e p95 | 631/h, 3,4 s média | montagens ≤ 240/h, p95 < 1 s | 1 |
| CPU por `/traccar/devices` | ~450 ms | < 50 ms | 2 |
| `/traccar/positions` escritório, chamadas/h | 1.000–1.135 | ≤ 60 | 3 |
| Long tasks em `/estoque/mapa` (90 s) | 13.776 ms, máx. 2.835 | < 1.000 ms, máx. < 200 | 4 |
| `alerts` seq_scan em 120 s | 12 | 0 | 5 |
| `alert:new` em 8 s (`ws-check`) | 55 | ≤ 5 | 6 |
| Alertas criados/dia | ~230 mil | ≤ 40 mil | 6 |
| Conexões WS do escritório/h | 70–118 | ≤ 10 (consequência de 1–3; serve de teste da cadeia) | — |

## Fora de escopo (decisões do dono)

- Fechamento em lote dos 2,9 M alertas abertos (pré-requisito da Task 6).
- Retenção de `positions` (51 GB), `tc_positions` (46 GB), `alerts`/`alert_history` (2,3 GB) — o disco a 93 % com +10 GB/dia é o risco nº 1 de queda e não é resolvido por este plano.
- Volume extra de 100 GB para backups/logs.
- Medição de dentro do escritório (rede) — procedimento no relatório §5.
- Troca de VPS — não recomendada com os dados atuais.
