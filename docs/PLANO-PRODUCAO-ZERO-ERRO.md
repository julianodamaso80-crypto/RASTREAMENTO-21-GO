# Plano de correções pré-produção — "Erro Zero"

> Auditoria completa feita em 2026-08-10 (Fable 5, sessão de revisão sem alterações de código).
> Cada item traz: problema, evidência (arquivo:linha), impacto e **como corrigir**.
> Executar em ordem de prioridade. Nenhuma correção foi aplicada ainda.

---

## P0 — Precisão de localização (o item que pode falir o projeto)

### P0.1 Posições inválidas/LBS entram no sistema como se fossem GPS real

**Problema.** O rastreador GT06/J16 sem sinal GPS manda posição por **torre de celular (LBS)** — erro de quilômetros. O Traccar marca essas posições com `valid: false` e/ou `outdated: true`, mas nós ignoramos as duas flags em TODOS os pontos do pipeline:

- [positions.service.ts:33-117](../backend/src/modules/positions/positions.service.ts) — `persistIfRelevant` grava qualquer posição no histórico sem checar `position.valid`/`outdated`. E grava `deviceTime` em vez de `fixTime` (linha 72).
- [traccar.gateway.ts:219-252](../backend/src/modules/traccar/traccar.gateway.ts) — `handleTraccarMessage` emite `position:update` pro dashboard e pro app do associado sem filtrar `valid=false`. Uma posição LBS com `fixTime` recente aparece no mapa como posição fresca e confiável.
- O model `Position` ([schema.prisma:689](../backend/prisma/schema.prisma)) não tem colunas `fixTime` nem `valid` — o histórico não consegue nem distinguir depois.

**Impacto.** Carro roubado: rastreador na mochila do ladrão sem céu aberto manda LBS → mapa mostra o carro a 3 km do lugar real. Exatamente o cenário que o dono descreveu como inaceitável.

**Como corrigir (3 camadas — defesa em profundidade):**

1. **Traccar (fonte):** no `traccar.xml` de PRODUÇÃO (verificar no droplet — o de dev em [docker/traccar/traccar.xml](../docker/traccar/traccar.xml) já não tem), adicionar:
   ```xml
   <entry key='filter.invalid'>true</entry>
   <entry key='filter.approximate'>true</entry>  <!-- descarta LBS -->
   <entry key='filter.future'>3600</entry>
   <entry key='filter.accuracy'>1000</entry>
   ```
   ⚠️ Reiniciar Traccar em janela controlada; conferir baseline antes/depois (rastreadores continuam reportando).
2. **Backend (gateway):** em `handleTraccarMessage`, se `position.valid === false` ou `position.outdated === true`, **não** emitir `position:update` nem persistir; opcional: emitir evento separado `position:approximate` pra uso futuro.
3. **Backend (histórico):** migration aditiva no model `Position`: `fixTime DateTime`, `valid Boolean @default(true)`. `persistIfRelevant` passa a gravar `fixTime: new Date(position.fixTime)` e pular posição inválida. Manter `deviceTime` pra não quebrar leituras existentes (replay/reports leem `deviceTime` — migrar leituras pra `fixTime` num segundo passo).

**Aceite:** simular posição `valid:false` (via OsmAnd ou insert manual no Traccar) → não aparece no mapa, não entra em `positions`, não vai pro app.

### P0.2 Validação de instalação usa heartbeat, não GPS real

**Problema.** [tech-field.service.ts:46-73](../backend/src/modules/tech/tech-field.service.ts) — o botão "tem sinal?" do técnico responde com `device.status === 'online'` + `device.lastUpdate`. Isso é **heartbeat** (keep-alive do SIM), não fix de GPS — viola a regra crítica do projeto (`position.fixTime ≠ device.lastUpdate`). O técnico pode finalizar a instalação com o módulo online mas o GPS mudo/errado.

**Como corrigir:**
1. `signal()` passa a buscar também a última posição (`traccar.getPositions(deviceId)`) e responder:
   - `online` (heartbeat), `lastUpdate`
   - `gpsOk`: `position.valid === true` && `fixTime` < 5 min && `satellites >= 4` (se disponível)
   - `position`: lat/lng/fixTime pra tela mostrar no mapinha.
2. PWA do técnico ([frontend/dashboard/src/app/tecnico/page.tsx](../frontend/dashboard/src/app/tecnico/page.tsx)): na tela de instalação, mostrar "GPS confirmado a Xm de você" — comparar posição do rastreador com geolocalização do navegador do técnico (`navigator.geolocation`). Distância > 500 m = aviso vermelho "posição do rastreador NÃO bate com o local da instalação" antes de permitir finalizar.
3. `finish()` (backend) registra no Device os campos de conferência: `installCheckFixTime`, `installCheckDistanceM` (aditivo, opcional) — auditoria de que a instalação foi validada com GPS real.

**Aceite:** instalar rastreador com GPS funcionando → app mostra "GPS confirmado, a Nm de você"; rastreador com antena ruim → tela impede/alerta antes de finalizar.

### P0.3 Device novo demora até 2 min pra "existir" no tempo real

**Problema.** [traccar.gateway.ts:150-156](../backend/src/modules/traccar/traccar.gateway.ts) — o mapping `traccarDeviceId → tenant/vehicle/associate` só atualiza a cada 2 min. Depois do `stock.associate()`, as posições do device recém-criado são descartadas pelo gateway até o próximo refresh (nem dashboard nem app recebem).

**Como corrigir:** expor `refreshDeviceMapping()` e chamá-lo ao fim de `stock.associate()` (e de `devices.linkVehicle`/`vehicles.create`). Como StockModule já não importa o gateway, usar `EventEmitter2` (`@nestjs/event-emitter`) — `this.eventEmitter.emit('vehicle.linked')` → listener no gateway chama o refresh. Alternativa mais simples: injetar o gateway via `forwardRef`.

**Aceite:** associar do estoque → posição chega no mapa em < 10 s (sem esperar 2 min).

---

## P1 — Integridade multi-tenant (vazamento entre empresas)

### P1.1 `stock.associate()` pode sequestrar veículo de OUTRO tenant

**Problema.** [stock.service.ts:219-226](../backend/src/modules/stock/stock.service.ts) — o dedupe de veículo busca:
```ts
OR: [ { plate, tenantId, deletedAt: null }, { uniqueId: item.imei, deletedAt: null } ]
```
O braço do `uniqueId` **não filtra tenant**. Se o IMEI existir num veículo de outro tenant, o update reatribui placa/associado desse veículo alheio.

**Como corrigir:** adicionar `tenantId` ao braço `uniqueId`. Se sobrar um veículo de outro tenant com o mesmo IMEI, tratar como conflito (422: "IMEI em uso em outra empresa").

### P1.2 `devices.create()` aceita `vehicleId`/`chipId` sem validar tenant

**Problema.** [devices.service.ts:105-106](../backend/src/modules/devices/devices.service.ts) — `dto.vehicleId` e `dto.chipId` entram direto no create, sem conferir se pertencem ao `tenantId` (o `linkVehicle` valida; o `create` não).

**Como corrigir:** replicar no `create` as mesmas validações do `linkVehicle`/`linkChip` (findFirst com `tenantId` + conflito se já vinculado). Aproveitar e, quando `vehicleId` vier no create, também setar `vehicle.traccarDeviceId` (hoje só o `linkVehicle` faz isso — device criado já vinculado fica invisível no mapa).

**Aceite (P1.1/P1.2):** teste automatizado com 2 tenants seedados provando o bloqueio.

---

## P1 — Pendências / Rota / Estoque (o ciclo pedido pelo dono)

### P1.3 Placa instalada REAPARECE nas pendências no sync seguinte ⚠️

**Problema.** O fluxo hoje: instalar → `removeByPlate` apaga a linha local ([installation-pendings.service.ts:156-178](../backend/src/modules/installation-pendings/installation-pendings.service.ts)). Mas o sync das 9h/17h faz **wipe + recreate** do espelho a partir do SGA ([:332-335](../backend/src/modules/installation-pendings/installation-pendings.service.ts)), e ninguém escreve de volta no SGA (confirmado: `hinova.service.ts` só tem leitura). Enquanto a operação não trocar o `tipo_adesao` manualmente no SGA, a placa instalada **volta pra fila e pode entrar em nova rota** → risco real de mandar técnico instalar de novo.

**Como corrigir (duas frentes, a 1 é obrigatória):**
1. **Filtro local no sync:** antes do `createMany`, excluir da lista as placas que já têm instalação concluída no tenant:
   ```ts
   const instaladas = await prisma.device.findMany({
     where: { tenantId, status: { in: ['INSTALLED','CONFIGURING','ONLINE','OFFLINE','MAINTENANCE'] }, vehicle: { isNot: null } },
     select: { vehicle: { select: { plate: true } } },
   });
   // remover de `linhas` toda l.plate presente nesse set (comparar placa normalizada)
   ```
   Cobrir também o caso placa vazia/chassi (matching por chassi como fallback).
2. **Write-back SGA (avaliar):** a API SGA v2 tem endpoint de alteração de veículo (`POST /alterar/veiculo`, conferir na doc oficial + testar em veículo de teste) — se funcionar com as credenciais atuais, setar `codigo_tipo_adesao = 2` (instalado) ao concluir. Fica como melhoria; o filtro local já garante o comportamento.

**Aceite:** instalar placa X → rodar sync manual (`startSync`) → placa X **não** volta pra `/pendencias` nem aparece nos bolsões de `/rotas`.

### P1.4 Sync pode zerar o espelho se o SGA responder vazio

**Problema.** Se o SGA devolver `200` com lista vazia (falha silenciosa que já vimos em gateway instável), `varrer` retorna `[]` sem lançar erro e o sync faz `deleteMany` + `createMany([])` — a tela de pendências zera e os bolsões de rota somem.

**Como corrigir:** guard de sanidade antes da transação: se `linhas.length === 0` e o espelho atual tem > 0, abortar com log de erro (`lastError = 'SGA devolveu 0 veículos — espelho preservado'`). Opcional: abortar também se a nova contagem < 30% da anterior.

### P1.5 Paradas de rota nunca são invalidadas quando a pendência morre no SGA

**Problema.** [routes.service.ts](../backend/src/modules/installation-pendings/routes.service.ts) — as paradas são snapshot. Se o contrato for cancelado no SGA (pendência some do espelho no sync), a parada continua `PENDING` na rota do técnico — ele vai até a casa de um contrato cancelado.

**Como corrigir:** ao fim do `sync()`, reconciliar rotas ativas: para cada `routeStop PENDING` cuja placa/`hinovaVehicleCode` (a) não está mais no espelho novo **e** (b) não tem Device instalado no tenant → marcar `status: 'CANCELLED'` (novo valor no enum do stop) com `note: 'Pendência saiu do SGA'`. Fechar rota se não sobrar parada PENDING. PWA do técnico mostra parada cancelada riscada.

### P1.6 `markStopDoneByPlate` sem try/catch pode devolver 500 pós-commit

**Problema.** [stock.service.ts:329-330](../backend/src/modules/stock/stock.service.ts) — `removeByPlate` engole erro internamente, mas `markStopDoneByPlate` não tem proteção. Se falhar, o cliente recebe 500 **depois** do vínculo já commitado — a tela mostra erro e o operador pode tentar de novo (segundo associate falharia com "já associado", confundindo).

**Como corrigir:** embrulhar a chamada em try/catch com log (mesmo padrão do `removeByPlate`).

### P1.7 Retirada/desinstalação não devolve o rastreador ao estoque

**Problema.** [devices.service.ts:158-164](../backend/src/modules/devices/devices.service.ts) — `remove()` só seta `deletedAt` no Device. Não limpa `vehicle.traccarDeviceId` (veículo segue no mapa com device "excluído"), não reabre o `StockItem` (`associatedAt` fica preenchido — o aparelho some do estoque pra sempre), não remove do Traccar. O ciclo "retirar rastreador e reaproveitar" (tipo_adesao 3/4 do SGA) não existe.

**Como corrigir:** criar fluxo explícito `uninstall`:
1. Device → `status: 'DEACTIVATED'`, `vehicleId: null`; Vehicle → `traccarDeviceId: null`, `status` conforme o caso.
2. StockItem do IMEI → `associatedAt: null`, `deviceId: null` (volta pro estoque disponível).
3. Traccar: manter o device (histórico) mas `disabled: true` via `updateDevice`.
4. UI: botão "Retirar rastreador" na ficha do device/cliente.

**Aceite:** retirar → aparelho volta em `/estoque`, veículo sai do mapa, histórico preservado.

---

## P1 — Segurança do app do associado

### P1.8 CPF funciona como senha PARA SEMPRE (mesmo com senha definida)

**Problema.** [associate-auth.service.ts:154](../backend/src/modules/app/associate-auth.service.ts) — `passwordMatches` retorna `true` se `typed === cpf`, **sempre**, mesmo quando o associado já tem hash de senha própria. Qualquer pessoa que saiba o CPF de um cliente (dado semi-público no Brasil) vê a localização do veículo em tempo real. Num produto de rastreamento isso é vetor de perseguição e de roubo dirigido.

**Como corrigir (mínimo viável antes de escalar a base):**
1. Tela/endpoint de troca de senha no app (`POST /app/auth/change-password`).
2. Regra: se `associate.password != null`, o CPF **deixa** de valer como senha (só o hash).
3. Primeiro login com CPF: forçar troca de senha (flag `mustChangePassword` — mesmo padrão já usado nos técnicos).
4. Conferir throttling específico no `/app/auth/login` (Throttler global existe; validar limite mais agressivo aqui, ex.: 5 tentativas/min/IP).

**Aceite:** associado com senha definida não loga mais com CPF; primeiro acesso exige troca.

---

## P2 — Robustez operacional (evita "caiu e ninguém viu")

### P2.1 Vínculo sem Traccar fica invisível pra sempre (sem reconciliação)

**Problema.** [stock.service.ts:300-324](../backend/src/modules/stock/stock.service.ts) — se o Traccar estiver fora no momento do associate, o Device fica sem `traccarDeviceId` com apenas um log warn. O veículo nunca aparece no mapa e ninguém é avisado.

**Como corrigir:** cron de reconciliação (a cada 10 min): buscar Devices GPS com `traccarDeviceId: null` e `status: 'INSTALLED'` → tentar `getDeviceByUniqueId`/`createDevice` de novo → atualizar Device + Vehicle. Expor contador "instalados sem rastreamento" no dashboard de conectividade pra ficar visível.

### P2.2 Crescimento sem limite: `positions` (nosso) e `tc_positions` (Traccar)

**Problema.** Nenhuma retenção nos dois bancos. Frota crescendo → disco do droplet enche → **produção cai** (Regra 0). Não há monitoramento de disco.

**Como corrigir:**
1. Nossa `positions`: cron diário deletando `deviceTime < now() - N dias` (N configurável por tenant, começar com 90) — ou particionamento por mês se preferir manter mais.
2. Traccar: verificar/definir tarefa de limpeza (Traccar 6 tem `database.saveOriginal` e task de cleanup via config; alternativa: cron SQL direto em `tc_positions` mantendo 90 dias).
3. Monitoramento: alerta simples de disco (cron no droplet: `df -h` > 80% → e-mail via Resend, ou node_exporter se quiser algo formal).

### P2.3 Duplicatas de Position em restart/reconnect

**Problema.** `lastPersistedByVehicle` é cache em memória ([positions.service.ts:16](../backend/src/modules/positions/positions.service.ts)); a cada restart do backend + reconexão do WS do Traccar (que reenvia o estado atual de todos os devices), posições já gravadas voltam e são regravadas. O replay mostra pontos duplicados.

**Como corrigir:** unique parcial em `traccarPositionId` (migration aditiva `CREATE UNIQUE INDEX ... WHERE traccar_position_id IS NOT NULL`) + `create` com catch de P2002 (ou `createMany skipDuplicates`).

### P2.4 `getDeviceByUniqueId` baixa TODOS os devices do Traccar

**Problema.** [traccar.service.ts:121-126](../backend/src/modules/traccar/traccar.service.ts) — busca client-side. Chamado em `stock.associate`, `tech signal` (cada clique do técnico!), `vehicles.create`, `devices.create`. Com a frota crescendo isso vira lentidão em cadeia no fluxo de instalação.

**Como corrigir:** o Traccar aceita `GET /devices?uniqueId=<imei>` (filtro server-side, aceita repetição do parâmetro). Trocar a implementação por esse filtro e manter o fallback client-side só se a versão não suportar (Traccar 6.5 suporta).

### P2.5 `stock.stats()` conta itens já associados

**Problema.** [stock.service.ts:115-132](../backend/src/modules/stock/stock.service.ts) — `stats` não filtra `associatedAt: null`, mas a listagem filtra. Os cards da tela de estoque mostram total ≠ soma da lista.

**Como corrigir:** decidir a semântica (provável: cards = estoque disponível) e alinhar o `where`; ou devolver os dois números (`disponíveis` / `instalados`).

### P2.6 Config do Traccar de produção — conferir no droplet

Checklist (o `docker/traccar/traccar.xml` local é de dev):
- `registration.enable` → **false** em prod (local está true).
- Filtros do P0.1 presentes.
- Geocoder: Nominatim público tem limite de 1 req/s e banimento por volume — com frota grande, avaliar desligar `geocoder.enable` (endereço já é resolvido no frontend?) ou apontar pra serviço pago.
- Senha do postgres (`postgres/postgres` no dev) — conferir que prod usa credencial forte.

### P2.7 Higiene de repositório

- `backend/.env.bak.1784234596` está **fora** do `.gitignore` (31 linhas, contém segredos) — apagar o arquivo e adicionar `*.env.bak*`/`.env.bak.*` ao `.gitignore`.
- `mobile/resposta-apple.md`, `testflight/`, `backend/.env.bak.*` aparecem soltos no git status — revisar o que não deve subir.

### P2.8 Sync SGA assume tenant único

`tenant.findFirst` em [installation-pendings.service.ts:225-229 e 251-255](../backend/src/modules/installation-pendings/installation-pendings.service.ts) e [hinova-sync.service.ts:46-49](../backend/src/modules/hinova/hinova-sync.service.ts). Correto hoje (1 tenant real), mas documentar no CLAUDE.md e, quando entrar o 2º tenant, mover credenciais SGA pra `TenantSettings` e iterar por tenant.

---

## Ordem de execução sugerida (waves de correção)

| Wave | Itens | Por quê primeiro |
|---|---|---|
| **A — antes de escalar produção** | P0.1, P0.2, P0.3, P1.1, P1.2, P1.3, P1.8 | Precisão de localização + vazamento entre tenants + reaparecimento de pendência + acesso por CPF são os que geram prejuízo real |
| **B — mesma semana** | P1.4, P1.5, P1.6, P1.7, P2.1, P2.7 | Fecham o ciclo estoque→instalação→cliente e a robustez do sync |
| **C — até 30 dias** | P2.2, P2.3, P2.4, P2.5, P2.6, P2.8 | Crescimento, performance e higiene |

**Regras pro executor (Opus):**
1. Uma correção por commit, mensagem `fix(escopo): descrição` em português.
2. Toda migration é **aditiva** (`IF NOT EXISTS`, colunas opcionais). Nunca `prisma db push` em prod — migration explícita.
3. Deploy: build sequencial no droplet (nunca backend+frontend em paralelo — OOM), push pro registry `localhost:5000`, `docker service update`, validar com curl 200 + grep no container (ver memória `feedback_deploy_via_registry`).
4. Cada item tem critério de aceite — testar antes de marcar como feito. P0.x exige teste com rastreador real ou posição simulada.
5. Baseline antes de mexer em produção: `trackgo.site` e `api.trackgo.site/api/v1/health` respondendo 200.

## O que já está BOM (não mexer sem motivo)

- Regra fixTime ≠ lastUpdate respeitada no dashboard ([tracking-context.tsx:226-241](../frontend/dashboard/src/contexts/tracking-context.tsx)), no app ([app-data.service.ts](../backend/src/modules/app/app-data.service.ts)) e nos crons de alerta ([alerts.cron.ts](../backend/src/modules/alerts/alerts.cron.ts) — OFFLINE e GPS_SILENT bem desenhados, com dedup e guard de falso positivo).
- Isolamento do app do associado no WebSocket (sala `associate:<id>`, nunca a frota do tenant).
- Retry/backoff do cliente SGA (8 tentativas, timeout 240 s, pausa entre páginas) — calibrado com medições reais.
- Transação do `stock.associate` (cliente+veículo+device+baixa do estoque atômicos).
- Baixa imediata local de pendência + parada de rota ao instalar (painel e PWA do técnico recarrega na hora).
- Geocoding com cache permanente por CEP e validação de bounding box do Brasil.
- Guard de tenant + throttling por tenant globais; controller do Traccar filtra devices/positions por tenant.
