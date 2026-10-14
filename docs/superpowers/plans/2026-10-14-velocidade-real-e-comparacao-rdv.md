# Velocidade real, validação completa e comparação com a Rede Veículos — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o painel e o backend do TrackGo rápidos de verdade **sem atrasar dado, esconder veículo ou afrouxar permissão**, provar com builds de produção e medições equivalentes, e comparar função a função com a Rede Veículos.

**Architecture:** Continua na branch `perf/lentidao-painel` (worktree `.claude/worktrees/perf-lentidao-painel`, base `206709d`). A validação real sai da máquina do dono (disco cheio) para um **host de build isolado no GitHub Actions** (já usado pelo projeto para iOS/Android): suíte completa com dependências reais, `nest build`, `next build` (2 configurações), e um ambiente de homologação efêmero (Postgres 17 + Redis 7 + Traccar 6.14.5 como *service containers*) onde o backend compilado sobe com e sem as flags e é testado por smoke/autorização/carga sintética. A comparação com a Rede Veículos roda no PC do dono, mesmo navegador e rede, contra a versão **publicada** (antes e depois), com ele mesmo digitando a senha dele numa janela aberta por mim.

**Tech Stack:** NestJS 11 / Prisma 7 / Postgres 17 / Traccar 6.14.5 / socket.io; Next.js 16 / React 19 / MapLibre / supercluster; GitHub Actions (ubuntu, service containers); puppeteer-core + Chrome; k6 **não** (sem dependência nova — carga com script Node `fetch`).

**Spec:** missão do dono de 14/10/2026 (§1–9) + `docs/research/2026-10-13-investigacao-lentidao-causa-raiz.md` + `docs/superpowers/plans/2026-10-13-correcao-lentidao-painel.md` (entregas A–E/D2 concluídas; não refazer) + `docs/superpowers/plans/2026-10-14-propostas-banco-alertas-app-retencao.md`.

**Estado verificado em 14/10/2026 09:40 UTC:** produção backend `b366657` (uptime 18 h), frontend `206709d`; branch `52bafc9`, 28 commits, árvore limpa; `origin/main` = `b366657`. Disco C: do dono com **0,3 GB livres** (pagefile 55 GB, hibernação 9,5 GB) — inviabiliza `npm ci`, builds, Docker e até `next dev` localmente.

## Global Constraints

- Produção intocada até pedido objetivo e autorização expressa por lote. Sem exclusão, retenção, fechamento de alerta, migration, contratação ou mudança sensível sem autorização específica.
- Nenhuma otimização pode: aumentar a idade do dado exibido (contar idade acumulada em todas as camadas), esconder veículo, remover validação de qualidade de GPS, afrouxar permissão, ou mostrar sucesso antes de concluir.
- Sem tokens administrativos nem segredos de produção para autenticar testes: homologação usa o seed (`admin@rastreamento21go.com.br`/`admin123`) e usuários criados pelo próprio teste (VIEWER, OPERATOR, CLIENT); a comparação com a RDV usa a conta do dono com a senha digitada por ele.
- Não modificar o `node_modules` compartilhado por junction; instalação de dependências só no runner do CI (`npm ci`, lockfile preservado) ou numa pasta nova autorizada.
- Não usar a VPS de produção como máquina de build/teste. Não usar a extensão Claude in Chrome (só puppeteer/Playwright).
- Cada medição declara o nível: **(1) sintético · (2) frontend local + API real · (3) homologação completa · (4) produção publicada**, e as versões/flags ativas.
- Metas (não são resultados): INP ≤ 200 ms p75; LCP ≤ 2,5 s p75; ação local ≤ 100 ms p95; API comum ≤ 500 ms p95 sob carga representativa; atualização válida refletida na tela ≤ 1 s p95 / 2 s p99; sem congelamento recorrente. Diferença dentro da variação = "inconclusiva".
- Comparação com a RDV: funções equivalentes, mesma máquina/navegador/rede, sessões separadas, rodadas alternadas (≥ 5 por função), primeira abertura e cache aquecido separados, mediana/p95 (p99 só com ≥ 20 amostras), volumes diferentes registrados.

## Review Focus

1. Ignição que chega num pacote sem fix válido precisa aparecer no painel em ≤ 2 s sem mover o carro para a coordenada reprovada — F2 testa atributo aplicado com posição inalterada.
2. Veículo vinculado agora tem de receber posição pelo WebSocket em ≤ 5 s, não em 2 min — F2 testa `refreshDeviceMapping` disparado pelo vínculo.
3. Com 7 k veículos, um lote de 1 posição recalcula 1 linha, não 7 k — F3 testa contagem de recálculos.
4. Mapa do estoque com cluster: soma dos totais dos clusters + pontos soltos = pontos com coordenada no enquadramento; busca por IMEI traz o item mesmo dentro de um cluster — F4 prova com captura e teste.
5. Lista do estoque depois de 10 × "Mostrar mais" e 20 min de uso não volta a travar — F5 mede; se travar, virtualiza.

---

## Ordem e dependências

| Ordem | Task | Camada | Precisa de | Entrega para o dono |
|---|---|---|---|---|
| F0 | Desbloqueios (dono): espaço em disco, push da branch + acesso ao GitHub Actions, senha da RDV digitada | — | dono | — |
| F1 | CI de validação no GitHub Actions: suíte completa, builds reais, homologação efêmera com smoke + autorização + carga sintética | infra de teste | F0 (push) | "suíte completa verde com dependências reais" |
| F2 | 6A — atributos válidos sem fix (ignição) e vínculo novo em tempo real | backend + frontend | — | fim dos atrasos de 56–64 s |
| F3 | 6B — recálculo incremental no `TrackingProvider` e 1 render por segundo | frontend | — | menos CPU em toda página |
| F4 | 6C — prova visual e por teste do cluster do estoque (totais, busca, zoom, estilo) | frontend + teste | F0 (disco) ou F1 | "mapa não está vazio" provado |
| F5 | 6D — lista do estoque em uso prolongado; virtualização se necessário | frontend | F0/F1 | sem trava após 10 × "Mostrar mais" |
| F6 | 6E — caminho completo do cache em homologação (frio, expiração, invalidação, concorrência, falha) | CI | F1 | idade acumulada medida |
| F7a | 6F — migration dos índices de `alerts` (arquivo, `CONCURRENTLY`, não aplicada) | banco (arquivo) | — | pedido de aplicação com DDL exata |
| F7b | 6F — dedup de alertas "por episódio" (R1/R2 do documento de propostas) atrás de flag, sem tocar histórico | backend | — | menos 70 % de alertas novos sem mudar regra de negócio |
| F7c | 6F — `/app/vehicles` por device do associado, sem fallback de frota, com testes de autorização | backend | — | app mais leve e mais seguro |
| F8 | Harness de medição de experiência (A/B/C/D por ação) para o nosso painel e para a RDV | ferramenta | F0 (senha) | tabela comparativa |
| F9 | Pedido de publicação por lotes + medição em produção (nível 4) | — | aprovação | tabela final |

F2, F3, F7a–c não dependem do disco (edição + jest local cabe em < 300 MB? **conferir antes**; se não couber, aguardam F0). F1 é pré-requisito de qualquer "publicável".

---

### Task F1: CI de validação (GitHub Actions)

**Files:**
- Create: `.github/workflows/validacao-perf.yml`
- Create: `backend/test/homolog/smoke.mjs` (Node ≥ 20, só `fetch`): login seed → JWT; cria usuários VIEWER/OPERATOR/CLIENT via API; chama `/api/v1/health`, `/stock/map` (×3, mede `geradoEm` igual/diferente), `/traccar/devices` (200 → `If-None-Match` → 304), rota protegida com VIEWER (403) e OPERATOR (200), `/app/vehicles` com CLIENT; registra JSON.
- Create: `backend/test/homolog/carga.mjs`: 6 req/s de `/stock/map` por 60 s + 2 req/s de `/traccar/positions` + sonda `/health` 1/s; reporta p50/p95/p99 por rota e montagens (via header/log) — flags ON e OFF em dois boots.
- Create: `backend/test/homolog/semear-frota.mjs`: cria 10.000 devices no Traccar do CI (`POST /api/devices`) e 9.386 `StockItem` + 7.000 `Vehicle` no Postgres do CI via Prisma (dados sintéticos, seed determinístico).

**Interfaces:** o workflow roda em `push` da branch `perf/**` e manual (`workflow_dispatch`); jobs: `backend-test` (npm ci → jest `--ci` completo → `nest build`; falha se qualquer suíte não carregar), `frontend-build` (npm ci → jest → `next build` sem args → `next build` com `NEXT_PUBLIC_POLLING_MODE=contingencia NEXT_PUBLIC_STOCK_MAP_CLUSTER=on`), `homolog` (services `postgres:17`, `redis:7`, `traccar/traccar:6.14.5`; `prisma migrate deploy` + seed; `semear-frota`; boot `node dist/src/main` com flags OFF → `smoke` + `carga`; boot com flags ON → `smoke` + `carga`; artefato `homolog-resultados.json`). Sem segredos de produção: `JWT_SECRET` de teste gerado no job.

- [ ] Steps: escrever workflow + scripts; rodar localmente só a sintaxe (`node --check`); push da branch (**autorizado em F0**); ler o resultado (`gh run view` com `gh auth` do dono, ou artefato baixado); corrigir até verde; commit `ci(perf): validacao completa com homologacao efemera`.

### Task F2: Atributos válidos sem fix e vínculo novo em tempo real (6A)

**Files:** `backend/src/modules/traccar/traccar.gateway.ts` (`handleTraccarMessage` ~380–424; `refreshDeviceMapping` ~186–230), `backend/src/modules/vehicles/vehicles.service.ts` + `stock.service.ts` (vínculo/desvínculo → `gateway.refreshDeviceMapping()` imediato), `frontend/dashboard/src/contexts/tracking-context.tsx`, `use-traccar-socket.ts`, `lib/tracking-polling.ts`; specs correspondentes.

**Interfaces:** novo evento `attrs:batch` (1×/s, por tenant): `{ deviceId, serverTime, attributes: { ignition?, power?, charge?, blocked?, batteryLevel?, sat? } }` emitido para posições **reprovadas** pelo portão (`assessPosition`), sem latitude/longitude; o painel aplica em `positionMap[deviceId].attributes` e `serverTime` **sem alterar** `latitude/longitude/fixTime`. `refreshDeviceMapping()` vira público e é chamado após toda mudança de `vehicle.traccarDeviceId` (vínculo, desvínculo, reinstalação). Reconciliação do modo contingência continua (cobre remoções).

- [ ] Testes: gateway emite `attrs:batch` para posição reprovada e não emite `positions:batch`; painel aplica ignição sem mover; vínculo chama `refreshDeviceMapping`. Commit por parte.

### Task F3: Recálculo incremental no TrackingProvider (6B)

**Files:** `tracking-context.tsx` (`useMemo[vehicles]` 381–431; handlers 308–332), `use-traccar-socket.ts`; `lib/vehicle-row.ts` (puro) + teste.

**Interfaces:** `derivarLinha(vehicle, device, position, agoraMin)` pura e memoizada por identidade (`WeakMap`/cache por `vehicle.id` com chave `{vehicle, device, position, minuto}`); `positions:batch` + `devices:batch` + `attrs:batch` do mesmo segundo aplicados num único `setState` (buffer no hook, flush por `queueMicrotask`/`setTimeout 0`); o `relogio` de 60 s só invalida linhas cujo status depende do tempo. Critério: perfil em `/tecnicos` 90 s com `tracking-context` + `utils` < 300 ms (hoje 3 s em dev).

### Task F4: Prova do cluster do estoque (6C)

Script puppeteer (nível 2 ou 3): `fitBounds` nos pontos com coordenada; contar clusters e pontos; somar `point_count`; comparar com `pontos.filter(coord).length`; buscar um IMEI que está num cluster → item aparece; selecionar → pino; zoom in até expandir; trocar mapa base (satélite) → marcadores persistem; capturas em `docs/clonagem/` (fora do git). Corrigir o que falhar; teste de regressão em `stock-cluster.test.ts` para a soma dos totais.

### Task F5: Lista do estoque em uso prolongado (6D)

Medir (nível 2/3) após 10 × "Mostrar mais" (2.200 cards) e 20 min com payloads a cada 15 s: long tasks, memória. Se total > 3 s/90 s ou máx. > 300 ms: janela por rolagem (render só do intervalo visível + buffer, `content-visibility: auto` nos cards) preservando busca, contagens, seleção e "ver todos"; teste puro da janela.

### Task F6: Caminho completo do cache (6E) — no CI
Cenários no `carga.mjs`: cache frio, expiração simultânea (60 req no mesmo segundo após TTL), invalidação durante montagem (escrita de `StockItem` via API no meio da rajada), Traccar fora (parar o container de serviço por 20 s), reconexão. Métricas: montagens, p95, idade máxima observada (`geradoEm` × hora da resposta), erros.

### Task F7a/b/c: índices (arquivo), dedup por episódio (flag), `/app/vehicles` por device
Conforme `2026-10-14-propostas-banco-alertas-app-retencao.md` §1, §2 (R1/R2), §3. Cada uma com testes; F7a só cria a migration `CONCURRENTLY` (não aplicada); F7b atrás de `ALERTS_DEDUP_EPISODIO` (padrão desligado), sem tocar histórico; F7c nunca devolve frota inteira (sem contexto → 403/[]), testes de autorização por perfil.

### Task F8: Harness de experiência e comparação com a RDV
`scripts/perf/medir-experiencia.mjs` (puppeteer-core): para cada ação (login; abrir painel; abrir mapa; buscar placa; abrir detalhe; abrir histórico de 24 h; abrir estoque; buscar IMEI): A = clique→primeiro feedback visual; B = clique→resultado utilizável (seletor do resultado + sem spinner); C = idade do dado (timestamp exibido × relógio); D = erros/long tasks; INP/LCP via `PerformanceObserver`. Rodadas alternadas nosso × RDV (≥ 5), frio × quente; saída CSV + tabela. Na RDV: janela visível, dono digita a senha; navegação em ritmo normal; nada é alterado.

### Task F9: Publicação por lotes e medição em produção
Pedido objetivo por lote (A+B backend; C+D+D2 frontend; F2/F3; F7), cada um com evidências do CI, riscos, reversão, critérios de interrupção; após aprovação, medir no pico com os scripts do relatório e com F8 (nível 4). Nenhuma publicação sem o pedido aprovado.

## Entrega final (formato pedido pelo dono)
Tabela: Funcionalidade | Nosso antes | Nosso depois | Rede Veículos | Atualização dos dados | Erros | Situação | Evidência — com situações "Validado e dentro da meta / Melhorou, abaixo da meta / Inconclusiva / Não testado-acesso pendente / Aguardando publicação ou aprovação"; seções "já rápido na versão publicada", "ainda lento e o que será feito", "mais rápido/equivalente/mais lento que a RDV", "único próximo gasto ou aprovação".
