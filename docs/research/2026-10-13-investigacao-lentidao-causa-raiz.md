# Investigação forense de lentidão — Rastreamento 21 GO

**Medição:** 13/10/2026, 20:15–22:00 BRT (23:15–01:00 UTC), em produção, somente leitura. Access log do Traefik cobre 15:00–01:00 UTC (12:00–22:00 BRT) do dia 13/10.
**Produção:** backend `b366657` (8 h no ar), frontend `206709d` (clusters do mapa principal, 5 h no ar), Traccar 6.14.5, Postgres 17, droplet 8 vCPU / 16 GB / 320 GB com 37 serviços de 8 projetos.
**Nada foi alterado.** Nenhum código, dado, configuração ou serviço foi tocado. SQL com `statement_timeout`; chamadas HTTP de teste: 5 por rota, espaçadas.
**Revisão independente:** as conclusões da primeira versão foram submetidas a revisão adversarial; a revisão derrubou a tese "servidor descartado" e a investigação continuou até os dados abaixo. Esta é a versão corrigida.

---

## 1. Diagnóstico executivo

**A lentidão é do backend, que trava em rajadas; as rajadas são causadas pelo próprio painel do escritório; e o que torna cada rajada cara é o custo de CPU de três rotas que montam a frota inteira a cada chamada.** A VPS como um todo fica 77–85 % ociosa porque o backend é **um único thread Node**: quando ele enfileira, os outros 7 núcleos não ajudam. **Trocar de VPS não resolve** — o gargalo é um núcleo, e ele não está cheio por falta de máquina, está cheio por trabalho repetido.

Prova de que é o servidor (e não só a rede do escritório), nos minutos ruins da tarde (14:02–15:31 BRT):

| O que | Evidência |
|---|---|
| Preflight `OPTIONS` (zero trabalho, resposta vazia) levou 6–29 s | 18h UTC: 50 de 6.458 OPTIONS acima de 2 s, máx. 28.946 ms; 17h: 47, máx. 9.113 ms; 21–23h: zero acima de 2 s |
| App do associado (outros IPs, outros links, resposta de 0 B) | `/app/alerts` 304: p99 4.731 ms às 18h, máx. 15.973 ms; `/app/vehicles` 304 de 0 B em 5–12,7 s às 17:48–17:57; às 21–23h p99 < 330 ms |
| Notebook do dono (1 aba, outro link) | `/alerts/unread-count` (26 B) cancelado pelo cliente a 27 s às 18:31; `/stock/connectivity` (12 KB) em 14,3 s |
| Fora do pico o mesmo backend responde em 8 ms | sonda de 120 s por dentro do container às 21:40 BRT: `/health` p50 8 ms, p95 286 ms, máx. 633 ms |

O que enche o thread (custo de CPU **medido no processo**, 5 chamadas espaçadas de 3 s, descontada a carga de fundo de 30 %):

| Rota | CPU do backend por chamada | Tamanho cru → gzip | Quem chama e quanto |
|---|---|---|---|
| `GET /stock/map` | **~850 ms** | 2,12 MB → 200 KB | mapa do estoque, a cada 15 s por aba **+ a cada troca de aba** (`visibilitychange`); escritório: 2.093/dia, **59 num só minuto (17:06 UTC), 46 em 8 s (18:31)** |
| `GET /traccar/devices` | **~450 ms** | 3,1 MB do Traccar → 190 KB | painel, a cada 8 s por aba; 5.295/dia do escritório |
| `GET /traccar/positions` | ~100 ms (+0,55 s esperando o Traccar) | 5,1 MB do Traccar → 3,74 MB → 500 KB | idem |
| `GET /app/vehicles` (app) | ~100–450 ms (baixa a frota inteira do Traccar: 8 MB) | 363 B | 12,7/min, p50 552 ms |

Conta do minuto 17:06 UTC (14:06 BRT), só o escritório: 59 × 0,85 s + 24 × 0,45 s + 24 × 0,10 s ≈ **63 s de CPU pedidos num minuto a um thread que tem 60 s** — mais crons, app e WebSocket. Resultado: fila de 6–29 s para todo mundo, inclusive para o preflight.

Cadeia completa:

1. Escritório abre o mapa do estoque em várias abas (20–30 aberturas de `/estoque/mapa` por hora, cada uma com um `?imei=` diferente) e troca de aba o tempo todo; cada aba pede `/stock/map` a cada 15 s **e** a cada vez que volta a ficar visível → rajadas de 5–7 chamadas/s (17:06:11–18 e 18:31:00–07 UTC).
2. Cada `/stock/map` custa 0,85 s de CPU: baixa 8 MB do Traccar, lê todos os 9.386 itens do estoque sem limite, cruza, geocodifica parados, serializa 2,1 MB. Não há cache: 46 abas = 46 montagens idênticas.
3. O thread do Node enfileira → OPTIONS em 6–29 s, respostas de 0 B em 5–16 s, `/traccar/positions` de 500 KB em 15–25 s.
4. Com a fila, o pong do socket.io passa de 20 s → servidor derruba o WebSocket → painel reconecta (2 s) e recarrega tudo (devices + positions + 4 páginas de `/vehicles`) → mais carga. Escritório: 532 conexões WS em 26 h, 231 com menos de 60 s.
5. No navegador, cada resposta de `/stock/map` (2,1 MB) re-renderiza o mapa do estoque sem cluster: medido em produção, **13,8 s de thread travada em 90 s (86 long tasks, pico de 2,8 s)** — é a "trava" que o operador sente nessa tela, independente da rede.
6. Por baixo de tudo, três cargas permanentes que mantêm o backend em 30 % de um núcleo e o Postgres em 27 % mesmo de madrugada: 230 mil alertas/dia (7 `alert:new`/s empurrados a cada aba), dedup de alertas com seq scan de 700 MB 6×/min, e 72 inserts/s em `positions` mantendo 24 GB de índices com 128 MB de `shared_buffers`.

---

## 2. Causas, com evidência e confiança

| # | Causa | Onde (código em produção) | Evidência | Confiança |
|---|---|---|---|---|
| 1 | **`/stock/map` sem cache, 0,85 s de CPU por chamada, chamado em rajada pelo escritório** | `stock-traccar.service.ts` `mapPoints` (findMany sem `take` + `Promise.all([getDevices(), getPositions()])` + `preencherEnderecos`); `estoque/mapa/page.tsx:107-120` (`REFRESH_MS = 15_000` + `visibilitychange` → `carregar`) | CPU medida: 8.870 ms para 5 chamadas (fundo ≈ 4.630) ⇒ ~850 ms cada. Log: 59 chamadas em 17:06, 46 em 8 s em 18:31, 293 acima de 5 s no dia. Uma aba sozinha (puppeteer, 90 s): exatamente 6 chamadas, a cada 15 s — a rajada vem de **muitas abas + trocas de aba**, não de bug de loop | Alta (custo e rajada medidos); a contagem de abas é inferida (20–30 aberturas/h com `?imei=` distinto) |
| 2 | **Payload de frota montado por chamada** (`/traccar/devices` 450 ms CPU, `/traccar/positions` 100 ms + 0,55 s de Traccar), polling de 8 s por aba mesmo com WebSocket vivo | `tracking-context.tsx:287` (`setInterval(poll, 8000)`), `traccar.service.ts:224` (`frotaCompartilhada`, coalesce de só 2 s), `traccar.controller.ts:42,63` | 5.295 `/traccar/positions` + 5.295 `/traccar/devices` por dia só do escritório; `ws-check`: o lote de 1 s já entrega 541 posições em 8 s — o polling é redundante com socket vivo | Alta |
| 3 | **Backend é um thread e enfileira** — OPTIONS e 304 de 0 B em segundos | `main.ts` (1 processo, sem cluster/worker) | Tabela da seção 1; sonda `/health` fora do pico: p50 8 ms, mas p95 286 / máx. 633 ms (crons e ingestão já causam pausas de 0,3–0,6 s) | Alta |
| 4 | **Mapa do estoque re-renderiza 9.386 itens sem cluster a cada 15 s** | `stock-map-container.tsx` (não recebeu o `supercluster` de `206709d`, que foi só no `map-container.tsx`) | Puppeteer em produção: 86 long tasks / 13,8 s travada em 90 s, pico 2,8 s; em `/tecnicos` (sem mapa, mesmo socket e alertas): 2 long tasks / 102 ms | Alta |
| 5 | **230 mil alertas/dia, nenhum resolvido, dedup por seq scan** | `alerts.cron.ts:46,134` (`@Interval(60 s)`), `vehiclesComAlertaRecente` = `findMany({ type, createdAt ≥ 30 min })`; `alerts.service.ts:357-426` (`createAlert` → `alert` + `alertHistory` + `emit alert:new` + dispatcher) | `alerts`: **2.910.089 OPEN, 20 RESOLVED**; 6.716 veículos com OFFLINE aberto; 24 h: OFFLINE 74.003, IGNITION 76.852, GPS_SILENT 25.988. EXPLAIN do dedup: `Parallel Seq Scan … Rows Removed 969112 … read=89386` (700 MB), 252 ms, 12×/120 s. `ws-check`: 55 `alert:new` em 8 s. `/alerts/unread-count` conta 2.496.134 não lidos por seq scan (0,7 s) | Alta (servidor). **No navegador o custo é pequeno**: `/tecnicos` com 7 alertas/s teve 102 ms de long tasks em 60 s |
| 6 | **Postgres de fábrica, índices mortos, disco** | `ALTER SYSTEM` só tem `jit/work_mem/effective_cache_size`; `schema.prisma` Position | `shared_buffers` 128 MB; hit do app 41 % (traccar 98 %); `positions` 27 GB + 24 GB de índices, 2 deles (`jamming`, `power_cut`, 6,56 GB cada) com **0 leituras desde 09/10** (estatísticas zeradas na queda do disco — janela de só 4 dias); 72 inserts/s com `LWLock`; disco 93 % (+10 GB/dia); swap 100 % (processos de outros projetos) | Alta como fato; **não é o que trava o painel hoje** (disco a 11–22 % de I/O) |
| 7 | Traccar: 9 logins de rastreador/s, cada um com seq scan em `tc_user_device` + `tc_devices` | consulta interna do Traccar | 1.083 seq scans em 120 s; Traccar 30–40 % de um núcleo; `/api/positions` 5,1 MB em 0,55 s | Alta, impacto menor |
| 8 | Rede do escritório / trecho Cloudflare | — | Mesmo fora dos travamentos do servidor, respostas grandes ao escritório demoram mais do que a outros IPs (p95 1.260 ms contra 1.003 ms do notebook). Hoje 20:40 BRT do notebook: 180–320 KB/s, ping ao edge 7 ms / 0 % perda; droplet → edge GIG 0 % perda / 109 ms | **Secundária e não isolada**: o que foi medido como "15–25 s" coincide com os minutos de fila no servidor |

---

## 3. Descartado com prova

| Hipótese | Prova |
|---|---|
| VPS sem CPU / precisa de máquina maior | `vmstat` 77–85 % idle; load 1,4–1,7 em 8 vCPU. O gargalo é **um** thread |
| Disco lento | `iostat` util 11–22 %, `w_await` ≤ 1,6 ms; pressão de I/O 2 % |
| OOM / backend morrendo | sem OOM no kernel em 24 h; os 2 `exit 137` de hoje são deploys (`OOMKilled=false`, 14:18 e 15:08 UTC); RSS estável 1,30 → 1,28 GB |
| Falta de compressão | gzip ativo no Traefik: 3,74 MB → 499 KB |
| Erros 5xx | 1 em 26 h |
| Frontend Next.js (SSR) | 4–5 ms por página; container 70 MB |
| Loop de requisições na página do estoque | reproduzido em produção: 1 aba = 6 chamadas em 90 s, a cada 15 s exatos |
| Custo dos alertas no navegador | página sem mapa com 7 alertas/s: 102 ms de long tasks em 60 s |
| Vazamento de memória (05/10) | sem sinal na janela |

---

## 4. Medições brutas

### 4.1 Access log Traefik, API, 26 h (15:00–01:00 UTC) — 68.412 linhas

Por hora, escritório (`187.62.241.174`), req/min sem OPTIONS: 15h=34, 16h=84, 17h=90, 18h=78, 19h=64, 20h=51, 21h=11.

`/stock/map` escritório por hora (n, média, >2 s, >5 s): 15h 151/1.370 ms/8/0 · 16h 546/2.206/80/43 · 17h 631/3.976/201/133 · 18h 521/5.337/154/87 · 19h 244/1.660/26/9 · 20h 302/1.995/72/14.
Segundos com ≥ 4 `/stock/map` do escritório: 16h 7 s (31 chamadas), 17h 22 s (122), 18h 14 s (84), 19h 1, 20h 1.

`/traccar/positions` escritório por hora: 15h 462/567 ms · 16h 1.012/651 · 17h 1.135/712 · 18h 1.005/1.110 (35 > 5 s) · 19h 884/628 · 20h 648/789 · 21h 149/2.165 (13 > 5 s).

Minuto 17:06 UTC, escritório, por segundo (sem OPTIONS): 17:06:00–10 → 1 `/stock/map` a cada 1–2 s + devices/positions/vehicles; **17:06:11 5×, :12 7×, :13 7×, :14 6×, :15 6×, :16 5×, :17 3×, :18 3× `/stock/map`**; depois volta a 1 por vez. Nesse minuto: 173 requisições, 28 MB, 59 `/stock/map` (máx. 26.345 ms), 28 `/vehicles` 304 (máx. 9.853 ms), 20 OPTIONS positions/devices (máx. 6.457 ms). OPTIONS de qualquer IP > 2 s nesse minuto: 18 de 117.

Minuto 18:31: 114 req, 21 MB, 49 `/stock/map` (máx. 41.507 ms), OPTIONS devices/positions máx. 28.946 ms, 3 reconexões WS do escritório. OPTIONS > 2 s de qualquer IP: 39 de 108. Notebook do dono no mesmo minuto: 13 requisições canceladas (499) a 27 s.

OPTIONS (todos os IPs) por hora: 16h 10/4.716 > 2 s (máx. 7,7 s) · 17h 47/5.426 (9,1 s) · 18h 50/6.458 (28,9 s) · 19h 2 · 20h 30/2.986 (12,7 s) · 21–23h 0.

Sonda do app (outros IPs): `/app/alerts` (304) p99 por hora: 16h 662 ms · 17h 1.887 · 18h **4.731** (máx. 15.973) · 19h 542 · 20h 672 (máx. 6.331) · 21h 324 · 22h 140.

WebSocket: 774 conexões em 3 h; durações: 113 < 10 s, 231 10–40 s, 59 40–50 s, 227 50–120 s, 105 2–10 min, 39 > 10 min. Escritório 26 h: 532 conexões, 231 < 60 s; por hora 70–118.

Status 3 h: 3.801×200, 2.667×204, 2.530×304, 751×0 (WS), 311×401 (108 login errado no app, 79+79 token vencido `/app/*`), 165×404, 37×499.

### 4.2 Direto no origin (sem Cloudflare), token temporário

`/traccar/positions` 0,68–0,73 s / 498 KB gzip (3,74 MB cru) · `/traccar/devices` 0,61–0,68 s / 191 KB · `/stock/map` 1,01–1,44 s / 198–206 KB (2,12 MB cru) · `/alerts/unread-count` 0,71–0,78 s / 26 B.
Traccar por dentro: `/api/devices` 0,46–0,50 s, 3,1 MB, 10.428 devices; `/api/positions` 0,54–0,58 s, 5,1 MB, 8.865 posições.
CPU do processo (`/proc/<pid>/stat`, 5 chamadas espaçadas de 3 s): positions 5.170 ms, devices 6.980 ms, stock/map 8.870 ms; fundo sem chamadas: 4.570 ms por 15 s (30 %).
Sonda `/health` por dentro, 120 × 1 s (21:40 BRT): p50 8, p95 286, p99 576, máx. 633 ms; 7 acima de 200 ms.

Do notebook do dono via Cloudflare (edge GIG, 20:40 BRT): positions 1,57–2,75 s a 180–320 KB/s; devices 0,85–1,34 s; stock/map 2,2–2,5 s; ping ao edge 7 ms, 0 % perda. Droplet → edge GIG `172.69.90.133`: 30/30, 0 % perda, 109 ms.

### 4.3 Navegador (puppeteer em produção, token temporário)

| Página | Duração | Requisições | Long tasks (> 50 ms) |
|---|---|---|---|
| `/estoque/mapa` | 90 s | `/stock/map` 6× (4,2 / 19,2 / 34,2 / 49,2 / 64,5 / 79,2 s), devices 10, positions 10, vehicles 12 | **86, 13.776 ms, máx. 2.835 ms** |
| `/estoque/mapa` (2ª) | 60 s | `/stock/map` 4× | 25, 4.033 ms, máx. 1.033 ms |
| `/tecnicos` (sem mapa) | 60 s | devices 8, positions 8, vehicles 8 | 2, 102 ms, máx. 51 ms |

### 4.4 Tempo real por dentro (`ws-check.js`, 8 s)

`{"alert:new":55,"positions:batch":8,"devices:batch":8}`, 541 posições em lote.

### 4.5 Postgres 17

Config: `shared_buffers` 128 MB, `work_mem` 32 MB, `effective_cache_size` 10 GB, `jit` off, `max_connections` 100, `track_io_timing` off, `max_wal_size` 1 GB. `pg_postmaster_start_time` 11/09; `pg_stat_checkpointer.stats_reset` **09/10 19:09** (estatísticas de tabelas e índices contam desde então: 4 dias).
`pg_stat_database`: rastreamento21go hit 41,09 %, 65 GB; traccar 98,09 %, 46 GB.
Deltas em 120 s: `alerts` 12 seq scans, 11,6 M linhas, 360.578 blocos (2,8 GB); `positions` 9.135 inserts (76/s), `tc_positions` 10.572 (88/s); `tc_devices`/`tc_user_device` 1.083 seq scans cada.
Amostras de `pg_stat_activity` (95 em 120 s): `SELECT * FROM tc_devices WHERE uniqueId = $1 AND id IN (SELECT … tc_user_device …)` 18; `UPDATE tc_devices SET status…` 16 (IO); `INSERT INTO tc_positions` 13 (LWLock/IO); `INSERT INTO positions` 15 (IO/LWLock); dedup de `alerts` 6.
EXPLAIN dedup (`type='OFFLINE' AND created_at ≥ now()-30min`, 1.254 linhas): Parallel Seq Scan, `read=89386`, 252 ms. `unread-count`: Parallel Seq Scan, 574 ms (com subconsulta minha).
`alerts`: heap 699 MB + índices 818 MB; status: OPEN 2.910.089 / RESOLVED 20; `read=false` 2.496.134. OPEN por tipo: OFFLINE 1.343.537 (mais antigo 30/04; 800.721 com > 7 dias), IGNITION_ON 497.307, IGNITION_OFF 497.132, GPS_SILENT 419.160, HARSH_ACCEL 120.557. OFFLINE nas últimas 24 h por veículo: 829 veículos com ≥ 40 alertas (37.034 alertas — parados), 1.357 com 10–39 (35.491), 367 com 1–9 (1.330 — oscilando).
`positions`: 77 M linhas, heap 27 GB; índices: `vehicle_id_jamming_device_time` 6,56 GB (0 scans), `vehicle_id_power_cut_device_time` 6,56 GB (0), `vehicle_id_device_time` 5,38 GB (38.607), `pkey` 2,98 GB, `tenant_id_device_time` 1,66 GB (8), `traccar_position_id_key` 1,66 GB (UNIQUE — usado na escrita, não conta como scan). 260.255 inserts na última hora.
Serviço Swarm do Postgres: `UpdateConfig.Order = stop-first`, sem limites de memória, `StopGracePeriod` 10 s, sem `-c` no comando (`ALTER SYSTEM` vale).

### 4.6 Máquina

`free`: 15 Gi, 5,8 Gi usados, 9,9 Gi cache, swap 1,8/2,0 Gi (node de outros projetos: 460 + 141 + 124 MB…; backend do rastreamento 16 kB). `df /` 288/309 GB (93 %). `docker stats`: backend 29 % / 1,25 GiB; Traccar 29 % / 832 MiB; Postgres 27 % / 4,0 GiB. Checkpointer: write_time 81 h desde 09/10 (esperado com `completion_target` 0,9 — não é problema).

### 4.7 Código em produção (lido em `b366657` / `206709d`)

- `tracking-context.tsx`: `setInterval(poll, 8000)` (`:287`) → `/traccar/devices` + `/traccar/positions`; pausa com `document.hidden`; a cada 4º tick `/vehicles` (4 páginas de 2.000); `handleAlert` → `setAlerts([...].slice(0,100))` (`:335`); `Provider value={{…}}` não memoizado (`:520`).
- `use-traccar-socket.ts`: `reconnectionDelay 2000`, `reconnectionAttempts Infinity`, deps `[token]`.
- `estoque/mapa/page.tsx:92-120`: `carregar` estável (`useCallback([])`); `setInterval(carregar, 15_000)` só com aba visível; `visibilitychange` → `carregar(false)`; `onValidated`/`onAtualizou`/`onRefresh` também chamam `carregar`. Nenhum loop.
- `traccar.service.ts:23,224`: `FROTA_CACHE_MS = 2_000`, `frotaCompartilhada` (coalesce).
- `alerts.cron.ts:46,134`: dois `@Interval(60 s)`; `vehiclesComAlertaRecente` sem `tenant_id` e sem `vehicle_id` no `where`.
- `audit.interceptor.ts:31`: ignora GET. `TenantThrottlerGuard`: 300/min por usuário.
- ⚠️ A branch local (`fix/estoque-ignicao-pacote`, HEAD `b11a08b`) **não contém** as correções de 05/10 (`cb6c319`, `364ab31`); produção contém. Correções devem partir do que está em produção.

---

## 5. Suspeitas não comprovadas e o que falta

| Suspeita | O que falta | Como obter |
|---|---|---|
| Quantas abas de `/estoque/mapa` ficam abertas no escritório (inferido 15–40) | contagem real | Perguntar ao time / olhar o Chrome de cada máquina num dia de pico; ou, após o deploy do cache (plano, Task 1), o número para de importar |
| Parte "rede do escritório" fora dos travamentos do servidor | medição no local durante uma travada | Num PC do escritório: `curl -w "%{time_total} %{speed_download}"` em `/traccar/positions` (token) a cada 10 s por 10 min + `ping 1.1.1.1`. Ping limpo e vazão baixa = trecho Cloudflare; ping sujo = link |
| Onde exatamente vão os 850 ms de `/stock/map` (Traccar parse × findMany × geocode × stringify) | perfil de CPU de 30 s | `docker exec $BE kill -USR1 1` + `/tmp/prof.js` (feito em 05/10). **Exige autorização** (liga o inspector no processo em produção) |
| O dispatcher de alertas manda push/e-mail por alerta | leitura de `alerts-dispatcher` em `b366657` | grep |

---

## 6. Ranking final

| Pos. | Gargalo | Impacto medido | Status |
|---|---|---|---|
| 1 | `/stock/map` sem cache (0,85 s CPU) em rajadas de 5–7/s do escritório | fila de 6–29 s para todos; 293 chamadas > 5 s/dia | Confirmado |
| 2 | Payload de frota por chamada (devices 450 ms, positions 100 ms + Traccar 0,55 s), polling de 8 s por aba com socket vivo | 10.590 chamadas/dia só do escritório; 12,7/min do app | Confirmado |
| 3 | Mapa do estoque sem cluster (9.386 itens a cada 15 s) | 13,8 s de trava em 90 s no navegador | Confirmado |
| 4 | 230 mil alertas/dia, 2,9 M abertos, dedup com seq scan de 700 MB 6×/min | Postgres 0,27 núcleo; backend 7 emits/s; tabela cresce 110 MB/dia | Confirmado (servidor); custo no navegador descartado |
| 5 | Postgres 128 MB de `shared_buffers`, 13 GB de índices mortos, disco 93 % | risco de queda (já caiu 3×), não é a lentidão de hoje | Confirmado como risco |
| 6 | Traccar seq scan por login (9/s) | 0,3–0,4 núcleo | Menor |
| 7 | Rede do escritório / Cloudflare | agrava respostas grandes; não isolada | Secundária |

---

## 7. Recomendações (cada uma ligada a uma causa medida)

1. **`/stock/map` calculado uma vez por tenant a cada 15 s, servido do cache para todas as abas, com coalesce** (causa 1). 46 abas → 1 montagem. Invalidar na escrita (validar/associar/desvincular). Elimina as rajadas que enfileiram o backend.
2. **Payload de frota do painel pré-montado e serializado uma vez por segundo** (`devices`/`positions` por tenant), com `ETag` → 304 quando nada mudou; e **polling do painel só como fallback** quando o socket está morto (causa 2). Corta 450 ms de CPU por `/traccar/devices`.
3. **Cluster no mapa do estoque** como foi feito no mapa principal (`supercluster`), e não refazer marcadores quando o payload é igual (causa 3).
4. **Alertas** (causa 4): índice `(type, created_at DESC)` para o dedup (ou `(tenant_id, type, created_at)` se o cron passar a filtrar por tenant); parcial `(tenant_id) WHERE read = false` para o contador; dedup de OFFLINE/GPS_SILENT por "um aberto por veículo" **só depois** de fechar os 2,9 M abertos antigos (alteração de dado, com OK do dono) e tratando o veículo que oscila; IGNITION sem `alert:new` ao painel (confirmar quem consome: sino, card, app). Retenção de `alerts`/`alert_history` é decisão do dono.
5. **Postgres** (causa 5): `shared_buffers` 2–3 GB (reinício de ~1 min: `CHECKPOINT` antes, `stop_grace_period` maior, conferir `MemAvailable`); `DROP INDEX CONCURRENTLY` dos dois índices de 6,56 GB **só** após confirmar com mais dias de estatística e grep de `jamming`/`powerCut` em `where` — **nunca** o `traccar_position_id_key` (UNIQUE, usado na escrita). Remedir o hit do cache depois do índice de alertas antes de decidir o reinício.
6. **App do associado**: `/app/vehicles` consultar só os devices do associado (`/api/positions?deviceId=`), não a frota.

O que **não** recomendo com estes dados: trocar de VPS; comprar plano de rede; mexer em `max_connections`/`work_mem`; cluster de Node (mascara o custo repetido em vez de removê-lo — só faz sentido depois de 1–3).

---

## 8. Limitações

- Access log só a partir de 15:00 UTC de 13/10 (rotação do Docker); a manhã não foi vista.
- Não medi de dentro do escritório; a parcela de rede fica como secundária e não isolada.
- Não liguei o inspector do Node (seria mexer no processo em produção); o perfil de CPU é passo opcional mediante autorização.
- `pg_stat_statements` não está instalado; a visão de consultas veio de amostragem (1/s por 120 s) e `pg_stat_user_tables`; as estatísticas contam desde 09/10 19:09.
- O bloqueio de WebSocket no puppeteer não surtiu efeito (o upgrade passou); a separação "contexto × mapa" veio da comparação `/tecnicos` × `/estoque/mapa`.
- Branch local atrás da produção; todo código foi lido nos commits em produção.
