# Propostas separadas: índices, alertas, app do associado e retenção

**Data:** 14/10/2026 · **Natureza:** documento de proposta. **Nada aqui foi executado.** Sem SSH, sem SQL em produção, sem migration, sem deploy, sem push.
**Fonte dos números:** [investigação de 13/10](../../research/2026-10-13-investigacao-lentidao-causa-raiz.md) (§2 causas 4–6, §4.5). Nenhuma medição nova foi feita; o que não foi medido está marcado **"não medido"** e vem com a consulta de leitura que o mede.
**Postgres:** 17 (sem *skip scan*; isso só chega no 18).

## 0. Mapa das propostas e do que cada uma exige

As quatro frentes são **independentes**: nenhuma é pré-requisito da outra. A ordem abaixo é de risco crescente.

| # | Proposta | Muda dado? | Muda comportamento visível? | Aprovação necessária |
|---|---|---|---|---|
| A | Índices de `alerts` (A1 dedup, A2 não lidos) | Não (só DDL aditivo) | Não | Dono, para a janela de execução (Regra 0) |
| B1 | Alertas: evitar duplicação técnica dos **novos** | Não | Não | Dono, para o deploy |
| B2 | Alertas: **mudar a regra de repetição** | Não | **Sim** (menos alertas, menos e-mails) | **Aprovação específica do dono** |
| B3 | Alertas: tratar o **histórico** de 2,9 M abertos | **Sim** | Sim (contador, lista) | **Aprovação específica do dono**, por tipo |
| C | App do associado: `/app/vehicles` por device | Não | Não (mesmo contrato) | Dono, para o deploy; entrega separada |
| D | Retenção por tabela | **Sim (apaga/arquiva)** | Sim (histórico some) | **Prazo é decisão do dono**; nada é proposto como prazo |

Regras gerais que valem para todas: conferir antes e depois que `/api/v1/health` do backend e o login do painel respondem 200, e que CRM e loja seguem em 200 (Regra 0); nenhuma mudança nasce ligada; ligar/desligar no backend = trocar env + reiniciar o serviço (~20 s), no frontend = rebuild + deploy; **não existe desligamento instantâneo sem reinício**.

---

## 1. A. Índices de `alerts`

### 1.1 Consultas reais e planos (já colhidos, §4.5)

| Consulta (código) | Frequência | Plano medido | Por que os índices atuais não servem |
|---|---|---|---|
| Dedup: `alert.findMany({ where: { type, createdAt >= now-30min }, select: { vehicleId } })` em `alerts.cron.ts:243-252`, chamada por `detectOffline` (`:46`, usa em `:84-87`) e `detectGpsSilent` (`:134`, `:168-172`) | 2 × `@Interval(60 s)`, mas o delta de 120 s mostrou **12 seq scans em `alerts`** (≈6/min) | `Parallel Seq Scan`, 1.254 linhas devolvidas, `Rows Removed 969112`, `read=89386` (700 MB), **252 ms**; 11,6 M linhas lidas e 2,8 GB em 120 s | Não filtra `vehicle_id` nem `tenant_id`. O único índice com `type` é `(vehicle_id, type, created_at DESC)` (`schema.prisma`, model `Alert`), que exige `vehicle_id` como primeira coluna; o Postgres 17 não faz *skip scan* |
| Contador do sino: `alert.count({ where: { tenantId, read: false } })` em `alerts.service.ts:514-517` (`getUnreadCount`) | a cada aba/refresh do painel | `Parallel Seq Scan`, **574 ms** (2.496.134 linhas não lidas) | `(tenant_id, created_at)`, `(tenant_id, deleted_at)` e `(tenant_id, status, created_at)` não cobrem `read` |
| Lista: `findAll` em `alerts.service.ts:475-505` (`findMany` + `count` com os mesmos filtros) | tela `/alertas` | **não medido** | `(tenant_id, created_at DESC)` serve a ordenação; o `count(*)` com filtro de status/lido varre milhões de entradas de qualquer jeito |
| `hasRecentAlert` em `alerts.service.ts:292-304` (POWER_CUT/JAMMING/COLLISION) | por evento | **não medido**, mas casa com `(vehicle_id, type, created_at DESC)` | — (já servido) |

**Índices atuais de `alerts`** (do schema): `pkey`, `(tenant_id, created_at DESC)`, `(tenant_id, deleted_at)`, `(tenant_id, status, created_at DESC)`, `(assigned_to_id, status)`, `(vehicle_id, type, created_at DESC)`. Tamanho total medido: **818 MB** (heap 699 MB). **Uso por índice (`idx_scan`) não foi coletado**: coletar antes de decidir qualquer remoção (consulta no §6, item 1).

### 1.2 DDL proposto (não executar)

**A1 — dedup do cron (prioridade 1; resolve o seq scan de 700 MB × 6/min):**

```sql
-- Nome igual ao que o Prisma geraria para @@index([type, createdAt(sort: Desc)]),
-- para o schema e o banco não divergirem.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "alerts_type_created_at_idx"
  ON "alerts" ("type", "created_at" DESC)
  INCLUDE ("vehicle_id");
```

`INCLUDE (vehicle_id)` permite *index-only scan* (a consulta só lê `vehicle_id`). *Index-only* depende do mapa de visibilidade: as páginas dos últimos 30 min ainda não vacuumadas terão *heap fetch*, o que é pouco (1.254 linhas).

- **Efeito esperado (não medido):** de 89.386 blocos lidos para algumas dezenas; de 252 ms para poucos ms; some a carga de 2,8 GB lidos/120 s. Sem mudar uma linha de código: o planejador passa a usar o índice sozinho.
- **Tamanho estimado:** ~130–180 MB (≈45 B por entrada × 2,9 M; os índices atuais da tabela têm em média 136 MB). É estimativa por largura de tupla; o valor real vem de `pg_relation_size` depois de criado.
- **Custo de escrita:** +1 índice em ~2,7 inserts/s de alertas (230 mil/dia). Desprezível ao lado dos 72 inserts/s de `positions` com 6 índices.
- **Não incluir `tenant_id`:** o cron de hoje não filtra por tenant (`alerts.cron.ts:247-250`). Se um dia filtrar (relatório §7.4), troca-se por `(tenant_id, type, created_at DESC)` em outra proposta.

**A2 — não lidos do sino (prioridade 2; ganho modesto sozinho):**

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "alerts_tenant_unread_idx"
  ON "alerts" ("tenant_id") WHERE "read" = false;
```

- **Tamanho estimado:** ~80 MB (2,5 M entradas pequenas).
- **Honestidade sobre o ganho:** o `count(*)` continua percorrendo ~2,5 M entradas do índice (esperado de 574 ms para algo na casa de poucas centenas de ms; **não medido**). O ganho real depende de B3 (reduzir os não lidos) ou de um contador mantido à parte. Por isso A2 **não** é recomendada isolada; decide-se junto com B3.
- **Custo de escrita:** `markAllAsRead` (`alerts.service.ts:510`) e `markAsRead` passam a remover entradas do índice parcial (atualização deixa de ser HOT para essas linhas). Hoje já mexe no índice de `status`; impacto pequeno, mas medir.

### 1.3 Procedimento de criação concorrente

Pré-condições (Regra 0): CRM e loja em 200; backend `/api/v1/health` em 200; `df` com folga (hoje 288/309 GB, ~21 GB livres; A1+A2 usam < 0,5 GB mais WAL equivalente); nenhum deploy, `VACUUM FULL`, `REINDEX` ou a purga das 03:20 BRT (`positions.service.ts:145`) em andamento.

1. **Conexão:** `DIRECT_URL` (sessão direta, **não** o pooler), em `psql` — `CREATE INDEX CONCURRENTLY` não roda dentro de transação nem em *pooler transaction mode*.
2. **Sessão:** `SET statement_timeout = 0; SET lock_timeout = '5s'; SET maintenance_work_mem = '256MB';` (o `lock_timeout` aborta se não conseguir o lock curto de início em vez de enfileirar tráfego atrás dele).
3. **Antes de criar, checar se já existe um índice INVALID com o mesmo nome** — `IF NOT EXISTS` **pula em silêncio** e deixa o índice quebrado no lugar:
   ```sql
   SELECT c.relname, i.indisvalid, i.indisready
     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname IN ('alerts_type_created_at_idx','alerts_tenant_unread_idx');
   ```
4. **Acompanhar** (outra sessão):
   ```sql
   SELECT phase, blocks_done, blocks_total, tuples_done, tuples_total
     FROM pg_stat_progress_create_index;
   ```
   Fases esperadas: `building index: scanning table` → `sorting live tuples` → `building index: loading tuples in tree` → `waiting for old snapshots` → `index validation: scanning index/table`. A fase de espera por *snapshots* antigos fica parada se houver transação longa aberta (conferir `pg_stat_activity` antes: `state <> 'idle'` com `xact_start` antigo).
5. **Janela sugerida:** baixo tráfego e fora das 03:20 BRT. O relatório mostra 21–23h BRT sem OPTIONS lentos; a janela exata é do dono. Duas leituras da tabela (699 MB) em disco a 11–22 % de utilização: minutos, não horas (estimativa). Custo: ~1 núcleo de 8 e I/O de leitura; sem bloqueio de escrita.
6. **Se falhar ou cancelar:** o índice fica `indisvalid = false`. Tratamento: `DROP INDEX CONCURRENTLY IF EXISTS "<nome>";` e repetir o passo. Um INVALID não é usado por consultas, mas **continua sendo mantido a cada INSERT** (custo sem benefício), então não deixar.
7. **Validar:** passo 3 devolvendo `indisvalid = true`; rodar de novo o mesmo `EXPLAIN (ANALYZE, BUFFERS)` do dedup (somente leitura, com `statement_timeout`) e comparar com `read=89386`/252 ms; `pg_stat_user_indexes.idx_scan` do novo índice subindo; `pg_stat_user_tables.seq_scan` de `alerts` parando de crescer ~6/min.
8. **Reverter:** `DROP INDEX CONCURRENTLY IF EXISTS ...` (instantâneo para o usuário; volta ao seq scan de hoje). Sem perda de dado.

### 1.4 Registro no Prisma

Precedente no repositório: `backend/prisma/migrations/20260930190000_indice_tag_positions_received_at/migration.sql` — índice criado à mão com `CONCURRENTLY` em produção, e a migration só tem `CREATE INDEX IF NOT EXISTS` (no-op onde o índice já existe).

- Criar uma migration com `CREATE INDEX IF NOT EXISTS` (sem `CONCURRENTLY`, porque a migration roda em transação) **do mesmo nome**; em produção, depois de criar o índice à mão: `prisma migrate resolve --applied <nome_da_migration>` (ou deixar rodar: é no-op). Nunca `drizzle-kit`/`prisma db push` contra produção.
- **A1** é expressável no schema como `@@index([type, createdAt(sort: Desc)])` (sem o `INCLUDE`; o Prisma não representa `INCLUDE` nem índice parcial). **A2** (parcial) não é expressável: ficaria só no SQL da migration. Registrar isso na migration, para ninguém "limpar" por engano num `db push` futuro.
- **Implementado em F7a (arquivo, não aplicado):** a migration `20261014120000_indices_alerts_dedup_tenant_e_nao_lidos` troca A1 por `(tenant_id, type, created_at DESC)` (o cron passou a filtrar `tenantId`) e mantém A2 parcial com o nome `alerts_tenant_id_nao_lidos_idx`. O §1.3 vale com esses nomes no passo 3; o cabeçalho da migration traz os comandos `CONCURRENTLY` e o `migrate resolve --applied`.
- O deploy do backend **não roda migration no boot** (memória do projeto); então registrar a migration não altera nada em produção por si só.

### 1.5 O que pode quebrar

Quase nada: DDL aditivo. Riscos reais: (a) índice INVALID esquecido (tratado acima); (b) transação longa travando a fase final; (c) disco, afastado (< 0,5 GB). Aprovação: **dono** para a janela.

---

## 2. B. Alertas: três decisões separadas

Fatos de base: 230 mil alertas/dia; **2.910.089 OPEN, 20 RESOLVED**; não lidos 2.496.134; últimas 24 h: OFFLINE 74.003, IGNITION 76.852, GPS_SILENT 25.988 (§2 causa 5, §4.5). Cada alerta novo faz `alert.create` + `alertHistory.create` + `vehicle.findUnique` + `emit alert:new` + `dispatcher.dispatch` (`alerts.service.ts:361-426`).

### 2.1 Quem consome o quê (levantado por grep)

| Consumidor | Onde | O que faz com cada alerta | Depende de qual tipo |
|---|---|---|---|
| Painel (sino, card, lista) | `traccar.gateway.ts:80` emite `alert:new` ao room `tenant:<id>`; `use-traccar-socket.ts:85` recebe; `tracking-context.tsx:397-400` faz `setAlerts([novo, ...prev].slice(0,100))` e `setUnreadCount(+1)` | Prepende na lista de 100 e soma 1 ao contador, **de todos os tipos, inclusive INFO** | Todos. `alerts-dropdown.tsx:18-19` mostra os 8 primeiros não lidos |
| API do painel | `GET /alerts`, `GET /alerts/unread-count` (`alerts.service.ts:475, 514`) | Lê do banco, não do socket | Todos |
| **App do associado** | `app-data.service.ts:464-492` (`getAlerts`), polling HTTP; **não há consumidor de `alert:new` em `mobile/`** (grep sem resultado) | Esconde `GPS_SILENT, IGNITION_ON, IGNITION_OFF, OFFLINE, HARSH_BRAKE, HARSH_ACCEL, BATTERY_LOW` (`:43-51`, usado em `:477`) | Só tipos fora da lista. **Mexer em OFFLINE/IGNITION/GPS_SILENT não altera o que o associado vê** |
| Push de ignição ao associado | `alerts.service.ts:95` e `:105` chamam `ignitionPush.avisar(...)` **direto**, fora de `createAlert`; `ignition-push.service.ts:6` tem o próprio limitador de 2 min | Push independente da linha em `alerts` | IGNITION. **Suprimir o alerta/emit de IGNITION não pode remover essas duas chamadas** |
| E-mail/push do dispatcher | `notification-dispatcher.service.ts:53-81`: e-mail se `settings.notifyChannels.email` **e** severidade ≠ INFO (`:63`); push é só um *placeholder* (`:81-84`) | OFFLINE (WARNING) e GPS_SILENT (CRITICAL) **passam** pelo filtro de severidade (`DEFAULT_SEVERITY`, `:22-40`); IGNITION (INFO) não | OFFLINE, GPS_SILENT. **Volume real de e-mails não medido** (depende de `notifyChannels.email` por tenant e da lista de destinatários) |
| Pontuação/analytics | `scoring.service.ts:108-113`, `vehicles-analytics` | Contam SPEED/HARSH_BRAKE/HARSH_ACCEL em janelas de dias | Não mexer nesses tipos sem olhar |

Consequência: IGNITION é o único tipo que hoje só alimenta sino/lista do painel (INFO, sem e-mail, oculto no app, push separado). OFFLINE/GPS_SILENT têm o caminho do e-mail. Qualquer mudança de B2 em OFFLINE/GPS_SILENT **muda o volume de e-mail** e deve passar pela regra do dono sobre e-mail (nunca enviar sem ordem): a proposta nunca *aumenta* envio, só pode reduzir.

### 2.2 B1 — evitar duplicação técnica de alertas novos (sem mudar a regra)

**O que é:** manter a regra de hoje ("no máximo 1 OFFLINE/GPS_SILENT por veículo a cada 30 min", `alerts.cron.ts:37`) e só torná-la barata e correta.
- **B1.a** Índice A1. Já remove a causa medida (seq scan 6×/min). É a mudança de maior retorno e **não toca código**.
- **B1.b (opcional, depois de A1 medido)** Em `vehiclesComAlertaRecente` (`alerts.cron.ts:243-252`) trocar `findMany` por `SELECT DISTINCT vehicle_id` ou `groupBy` — devolve 1 linha por veículo em vez de N alertas (hoje 1.254 linhas por chamada). Mesmo resultado, menos tráfego Prisma.
- **B1.c (só se medir duplicata real)** Duplicata de **mesmo instante**, p.ex. IGNITION_ON/OFF repetido em segundos (flap do GT06). Os criadores de IGNITION (`alerts.service.ts:88-106`) não têm janela de dedup, ao contrário de POWER_CUT/JAMMING (`hasRecentAlert`, `:292`). Se a consulta do §6 item 4 mostrar pares IGNITION do mesmo veículo e tipo a menos de N segundos, um *debounce* de N segundos é correção de duplicata, não mudança de política. **Sem essa medição, B1.c não deve ser feita** (e a escolha de N é do dono).
- **O que pode quebrar:** B1.a nada. B1.b/B1.c alteram a contagem só se houver bug de equivalência: teste com dados sintéticos comparando `Set` de veículos antes/depois.
- **Verificar:** `alerts` por hora igual ao de hoje (74 mil OFFLINE/24 h) depois da mudança — se mudar, não é B1.
- **Reverter:** `git revert` + deploy; B1.a: `DROP INDEX CONCURRENTLY`.
- **Aprovação:** dono, só para deploy.

### 2.3 B2 — mudar a regra de repetição (decisão do dono)

**Fato que motiva (derivado dos números do relatório):** 829 veículos com ≥ 40 OFFLINE em 24 h somam 37.034 alertas (≈ 1 a cada 30 min, parados); 1.357 com 10–39 somam 35.491; 367 com 1–9 somam 1.330 (oscilando). Ou seja, ~97 % do OFFLINE do dia é **repetição do mesmo episódio** (o veículo continua sem sinal e o cron recria o alerta a cada 30 min).

Variantes (cada uma muda o que o time vê):

| Variante | Regra | Depende de B3? | Efeito | Risco |
|---|---|---|---|---|
| R0 | Como hoje (30 min) | Não | — | — |
| R1 | **Um alerta por episódio**: novo OFFLINE só se o `lastUpdate` do device for diferente do `data.lastUpdate` do último OFFLINE do veículo (o campo já é gravado em `alerts.service.ts` `notifyOffline`, `data: { lastUpdate, minutesAgo }`) | **Não.** Alertas antigos têm outro `lastUpdate`; não bloqueiam nada | Cai de ~74 mil/dia para ~1 por veículo por queda | Quem usa o lembrete de 30 min para cobrar a equipe perde o lembrete (**decisão do dono**) |
| R2 | Reenvio com intervalo maior (p.ex. a cada N horas) | Não | Reduz sem zerar | Escolha de N é do dono |
| R3 | "Um alerta OPEN por veículo e tipo" (como `hasRecentAlert` faz para POWER_CUT, `:292-304`, com `status ≠ RESOLVED`) | **Sim, para essa variante**: hoje 6.716 veículos já têm OFFLINE aberto; R3 trataria todos como "já avisados" e **nunca mais alertaria** esses veículos até o histórico ser fechado | Igual a R1 depois do saneamento | Silenciar 6.716 veículos por acidente |

**Por que B3 não é pré-requisito de B1, nem de R1/R2:** B1 é só índice; R1 e R2 comparam com o episódio/tempo, não com "existe um OPEN". Só **R3** cria dependência — e isso é uma razão para preferir R1 (ou R2), não para fechar 2,9 M de alertas primeiro. (Relatório §7.4 colocou "fechar antes" como condição porque pensou em R3; esta proposta mostra a alternativa sem a dependência.)

- **GPS_SILENT** (CRITICAL, tem e-mail): qualquer redução exige aprovação específica, porque é o alerta de roubo/antena (`alerts.service.ts` doc de `notifyGpsSilent`). Sugestão: não incluir GPS_SILENT no primeiro lote; decidir separado.
- **IGNITION:** variante "não emitir `alert:new` ao painel, manter a linha em `alerts` e o push ao associado": exige um filtro por tipo no `emitter` (`alerts.service.ts:397-411`), mantendo `ignitionPush.avisar` (`:95,:105`). Mostra no painel só pela lista (HTTP) e não mais em tempo real. Decisão do dono: o operador precisa ver "ignição ligada" em tempo real no sino?
- **Verificar:** contagem de `alerts` por tipo/hora antes e depois; e-mails do dispatcher (Resend) não podem **subir**; painel: sino ainda recebe SOS/POWER_CUT/JAMMING em tempo real.
- **Reverter:** flag de ambiente (nasce desligada, regra de hoje por padrão) → reiniciar o serviço (~20 s).
- **Aprovação:** **específica do dono**, por tipo e variante.

**Implementado atrás de flag (F7b, commit `8a8f0c0`, não publicado):** `ALERTS_DEDUP_EPISODIO=1` liga uma variante de R1 em `alerts.cron.ts` para OFFLINE **e** GPS_SILENT; ausente ou qualquer outro valor = regra de hoje (janela de 30 min, mesma consulta). Regra exata: o veículo que já cumpre a condição de hoje (OFFLINE: sem contato há ≥ `offlineThresholdMinutes`; GPS_SILENT: heartbeat fresco, fix ≥ 15 min, estava em uso) só ganha alerta novo se o último alerta do mesmo tipo **não** for (a) de menos de 30 min (piso de hoje) nem (b) mais novo que o início do episódio — `lastUpdate` do device (OFFLINE) ou `fixTime || deviceTime` da última posição (GPS_SILENT). Se o veículo voltou depois do último alerta e caiu de novo, é episódio novo e alerta. Compara só `created_at`, não lê `status` nem altera histórico; uma consulta por rodada e tipo (`unnest` + `LATERAL … LIMIT 1` no índice `(vehicle_id, type, created_at DESC)`, só dos candidatos) — `findMany({ distinct })` foi descartado porque o `distinct` do Prisma Client sem `nativeDistinct` deduplica em memória. Log `debug` por rodada: `criados=… suprimidosPorEpisodio=…`. **Continua decisão do dono:** ligar a flag (perde o lembrete de 30 min, reduz e-mail do dispatcher), incluir ou não GPS_SILENT (hoje a flag cobre os dois; separar por tipo é uma linha), R2 (intervalo de reenvio), R3 e todo o §2.4 (histórico/retenção).

### 2.4 B3 — tratar o histórico (2.910.089 abertos)

Composição dos OPEN (relatório §4.5): OFFLINE 1.343.537 (mais antigo 30/04; 800.721 com > 7 dias), IGNITION_ON 497.307, IGNITION_OFF 497.132, GPS_SILENT 419.160, HARSH_ACCEL 120.557 = 2.877.693. **Restam 32.396 de outros tipos** (inclui os críticos legítimos: SOS, POWER_CUT, JAMMING, COLLISION etc.) que **não podem entrar em nenhum saneamento em massa** sem exame caso a caso. A distribuição desses 32.396 por tipo não foi medida (consulta §6 item 3).

Opções (da menos para a mais invasiva), todas **exigem aprovação do dono**:

| Opção | O que faz | Rastreabilidade | Custo/risco |
|---|---|---|---|
| H0 | Não fazer nada. Com A1, o dedup deixa de depender do tamanho | Total | Contador de não lidos segue com 2,5 M e `/alerts` segue com `count` grande |
| H1 | Marcar `read = true` em lotes, para tipos/idades escolhidos (usa o mesmo efeito do `markAllAsRead` que já existe, mas por filtro) | Total (linha intacta; fica sem o "não lido") | Atualiza milhões de linhas: WAL e *bloat* (+ tamanho da tabela até o vacuum); fazer em lotes de ~10 mil como o `purgeOldPositions` |
| H2 | Fechar como `RESOLVED` com `resolution` "encerrado automaticamente (política de DD/MM)" e uma linha `alert_history` por alerta | Boa, mas +2,9 M linhas em `alert_history` (a tabela tem 1 `CREATED` por alerta) e distorce relatórios de "tempo de tratativa" | Mais escrita; precisa de ação nova no `AlertHistoryAction`; "20 resolvidos" viram "2,9 M resolvidos" nas métricas |
| H3 | Arquivar para tabela fria (`alerts_arquivo`) e tirar da quente | Total, se copiar antes de remover e conferir contagem | Precisa de DDL e de job; `alert_history` tem `onDelete: Cascade` (`schema.prisma`, model `AlertHistory`), então mover/remover o alerta leva o histórico junto: copiar os dois |
| H4 | Apagar fisicamente | **Proibido** pela regra do projeto (soft delete, `deletedAt`); só com ordem expressa | Irreversível |

**Preservar sempre:** SOS, POWER_CUT, JAMMING, COLLISION, FUEL_THEFT, qualquer alerta com `assigned_to_id` ou `status ≠ OPEN`, e os 20 resolvidos. Critério de seleção por **tipo + idade**, nunca "tudo".
**Verificar:** contagem por tipo/status antes e depois somando igual (conservação); `unread-count` coerente; painel `/alertas` abre.
**Reverter:** H1/H2 só se houver backup/*snapshot* provado antes (Regra 0 item 2) — guardar a lista de IDs afetados; H3: copiar de volta.
**Aprovação:** específica do dono, tipo a tipo.

### 2.5 Perguntas de negócio para o dono (B)

1. O time usa o **lembrete a cada 30 min** de OFFLINE para cobrar equipe? Se não, R1 (um alerta por queda) serve?
2. OFFLINE tem **e-mail** para quem hoje? Algum tenant depende de receber o e-mail repetido?
3. O operador precisa ver **IGNITION ligada/desligada em tempo real** no sino, ou basta na lista?
4. GPS_SILENT entra na mudança de regra ou fica como está?
5. O que fazer com OFFLINE de **mais de 7 dias (800.721)** e de 30/04: arquivar, marcar lido, ou manter?
6. Alguém precisa de **relatório histórico de alertas** por quanto tempo (prazo de guarda)? (ver D)

---

## 3. C. App do associado: `/app/vehicles` só com os devices dele

### 3.1 Contrato real de visibilidade (lido no código)

- Autenticação: `AssociateJwtGuard` (`app/guards/associate-jwt.guard.ts`) valida JWT com `type: 'associate'` e segredo próprio, confere que o `Associate` existe e não está apagado, e põe `req.associate` + `req.tenantId`. O controller usa `@CurrentAssociate('id')` (`app-data.controller.ts:22,32-35`).
- Visibilidade: `getVehicles(associateId, tenantId)` (`app-data.service.ts:143-145`) = `vehicle.findMany({ where: { associateId, tenantId, deletedAt: null } })`. **Um dono por veículo** (`Vehicle.associateId` único e opcional, `schema.prisma` model `Vehicle`). **Não existe compartilhamento** (grep de `shared`/`VehicleShare` no schema sem resultado) e **não há perfil administrativo nessa rota**: operador/admin usa o JWT de `User` no painel, por rotas diferentes.
- Mesmo contrato em todas as rotas do app: `getHistory` (`:246-254`), `getTrips` (`:282-290`), `getJourney` (`:333-341`), `getHistoryReport` (`:387-396`), `setBlocked` (`:201-208`), `getAlerts` (`:464-466`).
- **Onde está o desperdício:** depois de achar os veículos do associado, `getVehicles` ainda baixa a **frota inteira** do Traccar — `getPositions()` e `getDevices()` sem argumento (`:172-173`; ~8 MB) — e só então filtra por `Map`. Isso é a CPU de ~100–450 ms por chamada e os 12,7 req/min do app (relatório §1).
- **Armadilha que a mudança precisa evitar:** `TraccarService.getPositions(deviceId?)` trata `deviceId` falso como "sem filtro" (`traccar.service.ts:209,215`): `0`, `undefined` ou `NaN` **devolvem a frota inteira** (e ainda pelo cache compartilhado, `:216`). Hoje isso é inofensivo porque o resultado é filtrado em seguida; numa versão "por device" um id vazio viraria vazamento. Também: `getDevices()` sem `all` já retorna só os devices vinculados ao usuário de sessão do Traccar (`traccar.service.ts:114-120`), o que continua igual.

### 3.2 Proposta

Dois métodos novos no `TraccarService`, que **nunca** caem para a frota:

- `getPositionsDosDevices(ids: number[])` e `getDevicesPorId(ids: number[])`: se `ids` vazio ou contiver valor não inteiro positivo, devolvem `[]` sem chamar o Traccar. Pedem `GET /positions?deviceId=a&deviceId=b` e `GET /devices?id=a&id=b` (parâmetro repetido, como já se faz em `getReportSummary`, `traccar.service.ts:247-262`). Em seguida **filtram a resposta pelo conjunto pedido** (defesa em profundidade: se o Traccar devolver a mais, descarta).
- `getVehicles` usa os dois só com os `traccarDeviceId` já obtidos do `findMany` escopado por `associateId + tenantId` (`:158-160`). Se a chamada ao Traccar falhar: erro (ou posição `null`), **jamais** `getPositions()`/`getDevices()` completos como alternativa.
- Atrás de flag de ambiente, **padrão desligada** (caminho de hoje). Entrega **separada** das demais propostas e do trabalho de painel.
- A suposição de que `/positions?deviceId=` sem `from/to` devolve a última posição de cada device é a documentada do Traccar, mas deve ser **validada em ambiente de teste com Traccar 6.14.5** antes de ligar; `getHistory` já usa `getPositions(deviceId, from, to)` (`app-data.service.ts:265`), então o caminho por device existe e roda.

**Casos legítimos que não podem se perder** (cada um é teste):
associado com vários veículos (PJ/CNPJ: mesmo `associateId`); veículo sem `traccarDeviceId` (continua `position: null`, sem chamada, `:160-162`); device inexistente no Traccar (`null`, igual hoje); dois veículos apontando para o mesmo device; veículo trocado de associado (a consulta ao banco manda a cada chamada); veículo apagado com IMEI "preso" (`deletedAt` continua filtrando); associado com muitos veículos (lotes de ids com teto para não estourar URL).

### 3.3 Testes de autorização (a escrever junto, com Traccar simulado; nada aponta para produção)

1. Associado A não recebe posição nem device do associado B, mesmo com o Traccar simulado devolvendo os dois (resposta filtrada pelo conjunto pedido).
2. Os `deviceId` enviados ao Traccar são exatamente os do `findMany` de A.
3. Associado sem veículos, ou com veículos sem `traccarDeviceId`: o Traccar **não é chamado**.
4. Outro `tenantId` com o mesmo `associateId`: lista vazia.
5. Falha do Traccar: nenhuma chamada de frota inteira (`getPositions()` sem argumento nunca invocado).
6. `deviceId` `0`, `NaN`, negativo, string: nenhuma chamada.
7. Flag desligada = resultado idêntico ao de hoje (teste de equivalência, mesma saída para o mesmo cenário).
8. O teste existente `app-data.contrato.spec.ts` (campos internos proibidos: `imei`, `installLocation`, `technicianId`...) continua passando sem alteração.

**O que pode quebrar:** posição `null` para quem hoje tem posição, se o Traccar tratar `?deviceId=` diferente do esperado (coberto pela validação em teste e pela flag). **Verificar:** `/app/vehicles` com a conta de teste interna (memória do projeto) comparando antes/depois; CPU da rota cai de ~100–450 ms. **Reverter:** flag desligada + reinício (~20 s). **Aprovação:** dono para o deploy; a entrega não depende de A, B nem D.

---

## 4. D. Retenção (sem escolher prazo)

### 4.1 O que existe hoje

| Tabela | Onde | Tamanho/ritmo medido | Retenção hoje |
|---|---|---|---|
| `positions` (Prisma) | 77 M linhas; heap 27 GB; índices ~24,8 GB (2 mortos de 6,56 GB; `traccar_position_id_key` UNIQUE) | 72–76 inserts/s (≈ 6,2 M/dia); 260.255 na última hora | Cron diário 03:20 BRT (`positions.service.ts:145-146`), padrão **90 dias** via `POSITION_RETENTION_DAYS` (`configuration.ts:99`), `DELETE ... WHERE device_time < corte` em lotes de 10.000, **no máximo 100 lotes = 1 M linhas por noite** (`:151,155`) |
| `tc_positions` (Traccar) | banco `traccar`: 46 GB no total (tamanho por tabela **não medido**) | 88 inserts/s (≈ 7,6 M/dia) | **não medido**; o Traccar tem a própria configuração de limpeza de histórico, a conferir na documentação da 6.14.5 e no `traccar.xml` de produção |
| `tag_positions` | 5,1 M linhas em 30/09 (comentário da migration `20260930190000`); hoje **não medido** | Apple devolve 7 dias a cada consulta; `@@unique([tenantId, serialNumber, seenAt])` | Nenhuma encontrada no código |
| `alerts` | 2,9 M linhas; heap 699 MB + índices 818 MB (≈ 0,52 KB/linha) | +110 MB/dia | Nenhuma |
| `alert_history` | tamanho **não medido**; 1 linha `CREATED` por alerta (`alerts.service.ts:382-389`) mais as ações | acompanha `alerts` | Nenhuma; `onDelete: Cascade` do alerta |
| Log do Traccar (arquivos do container, `tc_events`) | **não medido** | — | **não medido** |

**Dois fatos que precisam ser esclarecidos antes de qualquer prazo (eu não os resolvo):**
1. **A conta não fecha.** 77 M linhas ÷ 6,2 M/dia ≈ **12 dias** de dado, mas o padrão do código é 90. Ou a produção usa `POSITION_RETENTION_DAYS` bem menor, ou a taxa de 72/s é recente, ou há lacuna. Se a janela real for ~12 dias, **qualquer prazo acima disso aumenta o disco**, que está em 93 % (+10 GB/dia).
2. **A purga não acompanha a ingestão** se houver atraso: 1 M linhas/noite contra 6,2 M/dia de entrada. E o `WHERE device_time < corte` não tem índice com `device_time` à frente (os índices são `(vehicle_id, device_time)` e `(tenant_id, device_time)`), então cada lote tende a varrer a tabela — comportamento **não medido**.

### 4.2 Dependências por tabela (o que deixa de funcionar se linhas sumirem)

| Tabela | Quem lê (código) | Perda se apagar além do prazo |
|---|---|---|
| `positions` | Replay/análises `listByVehicle` (`positions.service.ts:186-200`); `findLatestByVehicle`/`findPreviousByVehicle` (`:203-225`); **último fix por veículo** `lastFixTimes` = `max(fixTime)` por veículo (`clients.service.ts:296-312`), base do status "sem GPS"; score do motorista (`scoring.service.ts:113`, até 50.000 pontos); `vehicles-analytics.service.ts:54,93` | Veículo cujo último fix válido é mais velho que o corte **perde o último fix** (aparece como "nunca teve") — preservar a última linha válida por veículo; replays/analytics de períodos antigos |
| `tc_positions` | Relatórios e histórico do painel e do app via Traccar (`reports.service.ts:59`, `app-data.service.ts:265`); `tc_devices.positionid` aponta para a última posição | Relatórios/histórico do app antes do corte; **não apagar a posição referenciada por `tc_devices.positionid`** (última posição do device) |
| `tag_positions` | Última posição da TAG (`clients-tags.ts:71,172`, `stock.service.ts:616`, `clients.service.ts:260`) e rastro/histórico | TAG sem sinal há mais que o prazo perde a última posição — preservar a última por `serial_number`. A Apple reenvia 7 dias: apagar < 7 dias só faz o coletor reinserir (idempotente pelo UNIQUE) |
| `alerts` | `scoring` (SPEED/HARSH em janelas), app (últimos 50–100), painel, auditoria | Histórico de ocorrências; traceabilidade de roubo/SOS (guardar por mais tempo que o ruído) |
| `alert_history` | trilha de tratativa (`alerts.service.ts:610`) | Auditoria de quem tratou o quê; some junto com o alerta (cascade) |

**Restauração:** nada disso tem cópia fora do próprio Postgres/Traccar que eu tenha verificado. **Antes de qualquer remoção**, existir backup/dump provado e restaurável (Regra 0). Não verifiquei se há backup agendado dessas tabelas.

### 4.3 Opções por tabela (prazo = decisão do dono)

Dois jeitos de reduzir: (i) **DELETE em lotes** — libera espaço para reuso interno da tabela, mas **não devolve disco ao sistema** sem `VACUUM FULL`/`pg_repack` (lock exclusivo ou ferramenta extra); (ii) **particionar por dia/mês** e fazer `DROP PARTITION` — devolve o disco na hora, mas é migração de 52 GB e o `@@unique([traccarPositionId])` precisa incluir a chave de partição (perde a garantia de idempotência de hoje). Para `alerts`/`alert_history`, a alternativa é **arquivar** (H3).

Custo por linha (medido: tamanho ÷ linhas): `positions` ≈ **0,67 KB/linha** com os índices atuais (≈ 0,5 KB se os dois índices mortos forem removidos, proposta do relatório §7.5, fora deste documento); `alerts` ≈ 0,52 KB/linha. `tc_positions`, `tag_positions`, `alert_history`: **não medido**.

| Opção (sobre `positions`) | Linhas removidas | GB liberados (reuso interno) | Devolve disco? | Risco | Reversível? |
|---|---|---|---|---|---|
| P0 manter como está | 0 | 0 | — | disco segue crescendo | — |
| P1 cortar em D1 dias | `n(D1)` = linhas com `device_time` anterior | `n × 0,67 KB` (ex.: cada 10 M linhas ≈ 6,7 GB) | Só com `pg_repack`/`VACUUM FULL` | perde replay/analytics antigos; último fix (preservar a última por veículo) | Só com backup |
| P2 cortar em D2 dias | idem | idem | idem | idem | idem |
| P3 particionar + `DROP PARTITION` | por partição | = tamanho da partição (heap + índices) | **Sim** | migração grande; muda o UNIQUE | Só com backup |

**A tabela de GB por prazo só pode ser preenchida com a distribuição por data**, que não foi medida: a consulta de leitura do §6 item 2 devolve linhas e tamanho estimado por faixa de idade (7/15/30/60/90/180 dias). Com ela, cada coluna "GB liberados" vira número real. Não inventei esses números.

Para as demais, mesma estrutura de decisão:
- `tc_positions`: opções = configuração de limpeza do próprio Traccar (a conferir na 6.14.5) ou `DELETE` próprio preservando `tc_devices.positionid`. **Mudança no banco do Traccar é a mais sensível** (o Traccar quebra se perder a posição referenciada); exige teste em cópia.
- `tag_positions`: manter N dias + a última por TAG. Volume pequeno hoje (5,1 M em 30/09); baixa urgência.
- `alerts`/`alert_history`: H1–H3 da seção 2.4 (marcar lido / fechar / arquivar). Ganho de disco pequeno (1,5 GB hoje, +110 MB/dia) — o motivo é desempenho do contador e do dedup, não disco.
- Log do Traccar: medir tamanho dos arquivos do container e a rotação do Docker (`json-file` com `max-size`/`max-file`) antes de propor.

**Prazo, lote, horário e quem aprova: do dono.** **Verificar depois:** contagem por tabela somando igual a (antes − removidas); relatórios de teste nos períodos que sobram; `lastFixTimes` de um veículo com último fix antigo ainda devolve o fix. **Reverter:** restaurar do backup provado; sem backup, **não é reversível** — por isso nenhuma remoção entra sem ele.

### 4.4 Perguntas para o dono (D)

1. Por quanto tempo precisa **replay/histórico de posição** por veículo (cliente, perícia, seguradora)? Há contrato ou exigência legal de guarda?
2. Relatórios do painel e histórico do app precisam voltar quantos dias?
3. Ok manter sempre **a última posição válida por veículo/TAG** mesmo além do prazo?
4. Aceita janela de manutenção com `pg_repack`/`VACUUM FULL` para devolver disco, ou prefere particionar?
5. Há backup agendado de `positions`, `tc_positions` e `alerts` que possa ser restaurado? Em qual local?
6. Prazo diferente para ruído (IGNITION/OFFLINE) e para crítico (SOS/POWER_CUT/JAMMING)?

---

## 5. Ordem sugerida (se o dono aprovar, item a item)

1. **A1** (índice do dedup): maior ganho, zero mudança de comportamento, reversível por `DROP INDEX`.
2. **C** (app por device): ganho de CPU do backend, entrega isolada, flag desligada.
3. **B1.b** e, se medido, **B1.c**.
4. Decisão do dono sobre **B2** (R1/R2) e **B3** (H0–H3); só então A2.
5. Decisão do dono sobre **D**, precedida das medições do §6 e de backup provado.

## 6. Consultas de leitura que preenchem as lacunas (não executadas; rodar com `statement_timeout`, uma por vez, com autorização)

1. Uso dos índices de `alerts`: `SELECT indexrelname, idx_scan, pg_relation_size(indexrelid) FROM pg_stat_user_indexes WHERE relname='alerts';`
2. Distribuição de `positions` por idade: contagem por faixa de `device_time` (7/15/30/60/90/180 dias) e `min(device_time)`; e o valor efetivo de `POSITION_RETENTION_DAYS` no serviço (`docker inspect`, só leitura).
3. OPEN por tipo e idade, incluindo os 32.396 fora dos 5 tipos listados: `SELECT type, count(*), min(created_at) FROM alerts WHERE status='OPEN' GROUP BY 1;`
4. Duplicatas de IGNITION: pares do mesmo `vehicle_id` e `type` com menos de N segundos entre si (janela de 24 h).
5. Tamanho por tabela: `pg_total_relation_size` de `tc_positions`, `tc_events`, `tag_positions`, `alert_history`; tamanho dos logs do container do Traccar.
6. E-mails do dispatcher: `notifyChannels.email` por tenant e uso do Resend nas últimas 24 h (confirma se OFFLINE gera e-mail em volume).
