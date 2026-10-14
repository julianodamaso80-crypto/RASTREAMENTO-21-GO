# Task B — relatório

**Status:** DONE_WITH_CONCERNS (preocupações menores, nenhuma bloqueante — ver o fim)

## O que foi implementado

- `backend/src/modules/traccar/frota-painel.service.ts` (novo)
  - `FrotaPainel { devices, positions, etagDevices, etagPositions, geradoEm }`.
  - `FrotaPainelService.frotaDoTenant(tenantId)`: com `FROTA_PAINEL_CACHE_MS > 0` usa `CacheCompartilhado` (chave `frota:${tenantId}`, TTL = env, `timeoutMs: 30_000`, `maxEntradas: 50`); com a env em 0, ausente ou inválida, monta a cada chamada. A env é lida no construtor com `Number.parseInt` + `Number.isFinite`, igual ao `StockTraccarService`.
  - A montagem roda `vehicle.findMany` com o mesmo `where`/`select` de hoje, monta um `Set<number>`, chama `getDevices()` e `getPositions()` em `Promise.all` e filtra com `Set.has`, o que preserva a ordem do Traccar. Tenant sem veículo: não chama o Traccar e devolve `[]` com etag próprio.
  - ETag: `W/"<sha1(JSON.stringify(lista)) com 20 hex>"`, calculado uma vez por montagem.
  - `get ligado` mostra se a flag está ativa.
  - `etagCasa(inm, etag)`: aceita uma lista separada por vírgula, ignora o `W/` e não trata `*` como acerto.
- `traccar.controller.ts`: `getDevices`/`getPositions` passam a receber `@Headers('if-none-match')` e `@Res({ passthrough: true })`.
  - Com `frota.ligado`: seta `ETag` e `Cache-Control: private, no-cache`; se o etag casa, chama `res.status(304)` e retorna `undefined`; senão, retorna a lista.
  - Com a flag desligada: o corpo do caminho antigo continua idêntico (ainda com `includes` e sem cabeçalho novo).
  - `positions/:deviceId/history` não mudou.
- `traccar.module.ts`: provider `FrotaPainelService`.

## TDD — RED/GREEN

**Step 1–4 (serviço)**
- RED: `npx jest frota-painel` com um stub que lança `não implementado` resultou em `Tests: 22 failed, 22 total`. Todas as falhas são `não implementado`, ou seja, falharam pelo motivo certo.
- GREEN: o mesmo comando, já com a implementação, deu `Tests: 22 passed, 22 total`.
- Cobertura dos testes:
  - 10 chamadas simultâneas fazem 1 `findMany`, 1 `getDevices` e 1 `getPositions`, e todas recebem o mesmo objeto.
  - O `where`/`select` é exatamente o de hoje.
  - Tenants diferentes recebem listas próprias e etags diferentes.
  - O formato do etag é weak com 20 hex.
  - Para as seeds 1, 2 e 3 (mulberry32, com ids duplicados, `null` e ids fora do Traccar), o resultado é deep-equal e na mesma ordem que o algoritmo antigo com `includes`.
  - Tenant vazio: `[]` com etag e sem ir ao Traccar.
  - Mesma frota dá o mesmo etag; mudar uma posição muda só o `etagPositions`.
  - Flag `'0'`, ausente ou `'abc'`: desligada, monta a cada chamada.
  - TTL (com fake timers): em 1.999 ms reaproveita a montagem; em 2.001 ms monta de novo.
  - Falha do Traccar não fica em cache.
  - `etagCasa`: 8 casos.
- Commit `4d0b2cd`.

**Step 5–8 (controller)**
- RED: `npx jest traccar.controller` deu `Tests: 8 failed, 2 passed`. Falharam os 8 testes com a flag ligada (o controller ainda não usava o serviço; ex.: `toBe` recebia a lista do caminho antigo). Os 2 testes com a flag desligada já passavam, como esperado, porque descrevem o comportamento de hoje.
- GREEN: `npx jest traccar.controller frota-painel` deu `Tests: 32 passed`.
- Lint: `eslint` limpo nos 3 arquivos. O `prettier --check` acusa só CRLF no controller e no módulo, por causa do autocrlf do checkout; o conteúdo normalizado para LF passa no prettier, e o eslint, que roda o prettier, passa.
- Build: `npx tsc --noEmit -p tsconfig.build.json` mostra só 4 erros pré-existentes e fora do escopo: `pdfkit` ausente (3) e `prisma/seed.ts` `PrismaClient` (1). Nenhum erro nos arquivos tocados.
- Commit `4c5601a`.

## Step 9 — prova com supertest (Express de verdade + `TransformInterceptor`)

`backend/src/modules/traccar/traccar.controller.e2e.spec.ts` sobe um Nest com `TraccarController`, `FrotaPainelService` real (Prisma e Traccar mockados), `TransformInterceptor` global e um middleware que põe `req.tenantId` a partir de `x-tenant`. Resultado: `Tests: 5 passed`.

Com `FROTA_PAINEL_CACHE_MS=2000`, para `/traccar/devices` e `/traccar/positions`:
- 1ª requisição: `200`, corpo `{ data: [...] }`, `ETag` no formato `W/"<20 hex>"` e `Cache-Control: private, no-cache`.
- 2ª, com `If-None-Match` igual ao etag recebido: `304`, `text === ''`, `body` = `{}`, `content-length` ausente ou 0, e o mesmo `ETag`.
- `If-None-Match: W/"outro", <etag>`: `304`.
- Etag do tenant A enviado pelo tenant B: `200`, etag diferente e a lista do B.
- Flag desligada: `200` com o corpo de hoje, sem `Cache-Control`, e o `ETag` continua sendo o padrão do Express (não o nosso).

Observação: o Express, sozinho, também converteria em 304 uma resposta com `ETag` setado e `If-None-Match` igual (`req.fresh` em `res.send`). O e2e prova a semântica do Express (sem corpo, com envelope); o teste unitário prova que o controller retorna `undefined` antes de serializar.

Commit `ccfbb4e`.

## Step 10 — medição SINTÉTICA

Arquivo: `frota-painel.perf.spec.ts`. Só roda com `PERF=1`; sem a variável, aparece como `1 skipped`. Cenário: 10.428 devices, 8.865 posições e 7.000 veículos, com Traccar e Prisma mockados. São 100 chamadas de `controller.getDevices` em 10 s. Mede só a CPU deste processo: não inclui Traccar, banco, serialização HTTP nem rede.

| Execução | Modo | montagens | CPU total | CPU/chamada | p50 | p95 |
|---|---|---|---|---|---|---|
| 1 | desligado | 100 | 4.578 ms | 45,78 ms | 40,31 ms | 55,52 ms |
| 1 | ligado (2000) | **6** | 344 ms | **3,44 ms** | 0,13 ms | 16,53 ms |
| 2 | desligado | 100 | 4.968 ms | 49,68 ms | 43,64 ms | 65,26 ms |
| 2 | ligado (2000) | **6** | 327 ms | **3,27 ms** | 0,14 ms | 14,85 ms |

- Critérios atendidos: ligado fez ≤ 6 montagens em 10 s, e a CPU por chamada ficou em ~7 % da desligada (meta < 10 %). As duas listas têm o mesmo número de itens (7.000).
- Nesta máquina o caminho antigo custa ~46 ms por chamada, contra ~450 ms medidos em produção. A proporção é o que vale, não o número absoluto.

Commit `5055b50`.

## Suítes finais

`npx jest traccar frota cache-compartilhado` deu `Test Suites: 1 skipped, 9 passed; Tests: 1 skipped, 114 passed`. O teste pulado é a medição de perf.

## Arquivos

- Criados:
  - `backend/src/modules/traccar/frota-painel.service.ts`
  - `backend/src/modules/traccar/frota-painel.service.spec.ts`
  - `backend/src/modules/traccar/traccar.controller.spec.ts`
  - `backend/src/modules/traccar/traccar.controller.e2e.spec.ts`
  - `backend/src/modules/traccar/frota-painel.perf.spec.ts`
- Alterados:
  - `backend/src/modules/traccar/traccar.controller.ts`
  - `backend/src/modules/traccar/traccar.module.ts`

## Auto-revisão

- Isolamento por tenant: a chave do cache é `frota:${tenantId}` e o etag sai do conteúdo da frota do tenant. Os guards continuam antes do controller e o `tenantId` vem de `req`.
- Semântica do 304: sem corpo, com `ETag` e `Cache-Control`; `*` não casa; lista separada por vírgula casa.
- Mesma ordem do legado: provada por deep-equal em 3 seeds.
- Caminho com a flag desligada: o corpo do método é byte-idêntico. Só a assinatura ganhou dois parâmetros, que o código antigo não usa, e nenhum cabeçalho é setado.
- Os arrays em cache são compartilhados entre requisições, mas nada os altera (o interceptor só envelopa).

## Preocupações

1. Com a flag ligada, uma montagem busca devices **e** positions, mesmo que só um dos endpoints seja chamado. Hoje o painel chama os dois, e as chamadas ao Traccar já são coalescidas por 2 s pelo `TraccarService`, então o custo extra é desprezível.
2. "Antes de qualquer trabalho": o 304 sai depois de `frotaDoTenant`, porque o etag depende da frota. Dentro do TTL isso é acerto de cache (~0,1 ms); fora dele há uma montagem por tenant a cada 2 s.
3. O título do brief diz "ETag forte", mas o corpo do brief e a decisão do controller dizem **weak**. Implementei weak.
4. Os ~450 ms de produção não foram reproduzidos localmente (aqui deu ~46 ms). A medição é sintética e vale pela proporção.

---

## Fix round 1

Commits: `9471948` feat(traccar): expõe quando começou a busca da frota servida pelo coalesce · `008cc85` fix(traccar): frota do painel conta a idade desde o Traccar e isola falha de devices e positions · `8d56030` docs(perf): etag da frota é weak, não forte.

### IMPORTANTE 1 — idade ≤ `FROTA_PAINEL_CACHE_MS` somando os dois caches
- `TraccarService.frotaBuscadaEm(rota: '/devices' | '/positions'): number | null` — só leitura, devolve o `at` da entrada vigente de `frotaCache` (`null` se ausente ou já com ≥ 2 s). Lógica do coalesce intocada.
- `FrotaPainelService.montar`: `geradoEm = min(buscas bem-sucedidas)`, fallback `Date.now()`. **Desvio deliberado do texto:** leio `frotaBuscadaEm` logo depois de *disparar* `getDevices()/getPositions()` (síncrono, antes do `await`), não depois de obter o resultado. Motivo: `frotaCompartilhada` grava a entrada de forma síncrona, então nesse instante a entrada é exatamente a da promessa que recebemos; lida depois do `await`, uma busca de > 2 s poderia já ter sido substituída por outra mais nova (subestimaria a idade) ou apagada por falha.
- TTL como função do valor: `(f) => max(0, cacheMs - (Date.now() - f.geradoEm))`. Verificado em `cache-compartilhado.ts:56-57`: a função é avaliada **no momento de gravar**, e `expiraEm = Date.now() + ttl(valor)` ⇒ `expiraEm = geradoEm + cacheMs`. Leitura é fresca enquanto `Date.now() < expiraEm`. TTL 0 (busca já vencida) ⇒ não serve do cache na próxima chamada. Ressalva: quem espera uma montagem em voo recebe o valor ao fim dela (idade ≤ cacheMs + duração da montagem, que é `findMany` + filtro, o fetch em si já está contado).
- Testes (`frota-painel.service.spec.ts` › "idade medida desde a busca no Traccar"): busca em t0, montagem em t0+1.500 → fresca em t0+1.999, remonta em t0+2.000 (não t0+3.500); `geradoEm` = a busca mais antiga entre devices e positions; sem registro → agora; busca já mais velha que o TTL → não guarda. `traccar.service.frota.spec.ts` (novo, 4 testes): null sem busca; instante por rota; coalesce dentro de 2 s mantém o instante; vencida → null; consulta por device/período não conta.

### IMPORTANTE 2 — falhas desacopladas
- `Promise.allSettled`; `FrotaPainel` ganhou `erroDevices?: unknown` / `erroPositions?: unknown` (chave presente só quando falhou; o lado que falhou fica `[]`). Resultado com erro: TTL `min(restante, 1000)`.
- Controller: `if ('erroDevices' in f) throw f.erroDevices;` (mesmo objeto do Traccar → mesmo tratamento do filtro global) antes de setar qualquer cabeçalho; idem `erroPositions` em `/positions`.
- Testes: serviço — positions falha → devices ok + `erroPositions` é o mesmo objeto; inverso; os dois ok → sem erro; erro dura no máximo 1 s (fresco em +999, remonta em +1.000 e volta ao normal). Controller — `/devices` 200 e `/positions` rejeita com o **mesmo** erro (`rejects.toBe(erro)`); inverso; erro não manda ETag nem 304. E2E supertest — Traccar `/positions` fora: `/traccar/devices` 200 com envelope, `/traccar/positions` 500, 1 só `findMany`.

### MENORES
- M1: `etag = sha1(tenantId + '\n' + JSON.stringify(lista))` — feito com dois `update()` em vez de concatenar a string (a concatenação de ~3 MB custava ~2 ms/chamada a mais na medição; mesmo digest). Teste: mesma lista em dois tenants → etags diferentes.
- M3: `if (PERF)` redundante removido do perf spec.
- M4: plano — "ETag forte" → "ETag (weak)" no título da Task B (linha 103) e também na frase da Architecture (linha 7), única outra ocorrência; a linha da tabela (40) não continha "forte", ficou como estava.
- Extra: `traccar.controller.e2e.spec.ts` com `logger: false` (saída limpa no teste de 500) e `jest.setTimeout(30_000)` — numa rodada fria uma suíte e2e falhou uma vez sob carga (não reproduzida em 4 rodadas seguintes, inclusive com `--clearCache`); atribuo ao timeout de 5 s ao subir o Nest com ts-jest frio.

### Verificação
- `npx jest traccar frota cache-compartilhado` → `Test Suites: 1 skipped, 10 passed, 10 of 11 total; Tests: 1 skipped, 130 passed, 131 total`. Nenhuma dessas suítes depende de `pdfkit` (as 14 que não carregam por pdfkit estão fora desse filtro).
- `npx tsc --noEmit -p tsconfig.json` → só erros pré-existentes: `prisma/seed.ts` (`PrismaClient`) e `pdfkit`. Nenhum nos arquivos tocados.
- ESLint nos arquivos tocados: limpo. `traccar.service.ts` tem 32 erros de eslint **pré-existentes** (mesma contagem na versão de `2a65c4c`), nenhum nas linhas novas.
- Perf sintético (`PERF=1 npx jest frota-painel.perf`, 4 rodadas após o fix): desligado 41–46 ms CPU/chamada, 100 montagens; ligado **6 montagens**, 1,9–2,8 ms CPU/chamada (~5 %), p50 0,11 ms, p95 13–16 ms.

## Fix wave final

- JSDoc de `frotaCompartilhada` movido para logo acima do método; `frotaBuscadaEm` mantém o seu. Sem mudança de comportamento.
- Roteiro de publicação: `/health` trocado por `/api/v1/health` (linhas 224 e 227).
- Teste: `cd backend && npx jest traccar frota`
  - Test Suites: 1 skipped, 9 passed, 9 of 10 total
  - Tests: 1 skipped, 120 passed, 121 total
- ESLint em `traccar.service.ts`: 32 erros (os mesmos 32 pré-existentes, nenhum novo).
