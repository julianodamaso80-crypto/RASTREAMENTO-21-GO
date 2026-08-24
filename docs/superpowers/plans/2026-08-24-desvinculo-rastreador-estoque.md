# Desvínculo do rastreador e retorno ao estoque reutilizável — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um clique no card do cliente desvincula o rastreador do veículo, devolve o aparelho ao estoque com o IMEI intacto e comunicando no servidor GPS, e permite instalá-lo em outro veículo de outro associado sem erro e sem sobrescrever o cadastro antigo.

**Architecture:** O caminho `POST /devices/:id/uninstall` já existe e já devolve o item ao estoque; ele é corrigido em três pontos que hoje impedem a reutilização (o veículo antigo segura o IMEI no campo `unique_id`, que é UNIQUE global; o device fica `disabled: true` no Traccar e nada o religa; o item volta com o selo de validação e os carimbos do ciclo anterior). O lado da instalação (`POST /stock/:id/associate`) ganha a guarda espelhada — recusa IMEI que ainda esteja preso a outro veículo — e passa a reescrever o `unique_id` do veículo que recebe o aparelho. No dashboard, a ação sai de dentro do menu de três pontinhos e vira botão visível no card.

**Tech Stack:** NestJS 11 + Prisma + Jest (backend); Next.js 16 + React 19 + shadcn/ui + lucide-react (dashboard); Traccar 6.5 em produção (6.14.5 é o alvo do upgrade — o comportamento usado aqui é idêntico nas duas versões, ver Fundamentos).

## Global Constraints

- **Multi-tenant:** toda query nova filtra por `tenantId`. Sem exceção, mesmo `findFirst`/`findUnique`.
- **Soft delete:** models com `deletedAt`; nunca `delete()` físico.
- **Imports do Prisma Client:** usar `.prisma/client`, não `@prisma/client`.
- **Roles em inglês, UI em PT-BR.** Rotas backend em inglês (`/devices`, `/stock`), rotas do dashboard em PT-BR (`/clientes`, `/estoque`).
- **Nenhuma migration neste plano.** Nada de coluna nova: o schema atual já tem tudo o que o fluxo precisa. Se alguém sentir falta de um campo, isso é escopo de outro plano.
- **Nada é enviado ao rastreador.** Nenhum SMS, nenhum comando TCP, nenhuma troca de APN/servidor. O aparelho continua apontando para `gps1.trackgo.site` exatamente como está. O desvínculo é só cadastral.
- **Commits em português**, formato `tipo(escopo): descrição`.
- **Executar em branch**, nunca direto na `main`: `git checkout -b feat/desvinculo-rastreador`.
- **Deploy:** builds sequenciais no droplet (backend, esperar terminar, depois frontend), `tag + push` pro registry `localhost:5000`, `service update` **pelo digest**, e verificação tripla (ver Task 8).

---

## Fundamentos — o que foi verificado antes de escrever este plano

Cada afirmação abaixo tem origem em arquivo do repositório ou no código-fonte do Traccar. Nada aqui é suposição.

**F1 — O desvínculo já existe e já devolve o item ao estoque.**
`POST /devices/:id/uninstall` ([devices.controller.ts:85](../../../backend/src/modules/devices/devices.controller.ts#L85), `SUPER_ADMIN`/`ADMIN`/`OPERATOR`) chama `DevicesService.uninstall` ([devices.service.ts:243](../../../backend/src/modules/devices/devices.service.ts#L243)), que numa transação: zera `Device.vehicleId`/`chipId`, põe `status: 'DEACTIVATED'`, carimba `uninstalledAt`/`uninstalledBy`/`uninstallReason`, zera `Vehicle.traccarDeviceId` e devolve o `StockItem` (`associatedAt: null`, `deviceId: null`). A UI existe em `/clientes`, dentro do menu de três pontinhos ([asset-actions-menu.tsx:117](../../../frontend/dashboard/src/components/clientes/asset-actions-menu.tsx#L117)).

**F2 — O veículo antigo continua segurando o IMEI, e é isso que quebra a reinstalação.**
`Vehicle.uniqueId` é `@unique` **global** ([schema.prisma:422](../../../backend/prisma/schema.prisma#L422)) e recebe o IMEI quando o veículo nasce pelo estoque ([stock.service.ts:536](../../../backend/src/modules/stock/stock.service.ts#L536)). O `uninstall` **não** limpa esse campo. Na instalação seguinte, o `associate` procura o veículo assim ([stock.service.ts:502-507](../../../backend/src/modules/stock/stock.service.ts#L502-L507)):

```ts
OR: [{ plate: placa }, { uniqueId: item.imei }]
```

Dois desfechos, ambos errados: se casar pelo `uniqueId`, o `update` seguinte troca placa, chassi, modelo e `associateId` **do veículo do cliente antigo** — o registro do antigo vira o do novo, levando junto posições, alertas e score; se não casar com nada, o `create` com `uniqueId: item.imei` viola a constraint global e o técnico leva 500. Não existe nenhum teste cobrindo esse caminho (o mais próximo é "mesmo rastreador reinstalado na **mesma** placa", [stock-associate-rastreador-ocupado.spec.ts:119](../../../backend/src/modules/stock/stock-associate-rastreador-ocupado.spec.ts#L119)).

**F3 — Device desabilitado no Traccar não cria sessão: o rastreador fica mudo para o servidor.**
O `uninstall` chama `updateDevice(traccarDeviceId, { disabled: true })` ([devices.service.ts:285-288](../../../backend/src/modules/devices/devices.service.ts#L285-L288)) e **não existe um único `disabled: false` em todo o backend** (grep em `backend/src`). No Traccar, quando o rastreador se identifica, `ConnectionManager.getDeviceSession` chama `device.checkDisabled()`:

```java
// org/traccar/session/ConnectionManager.java  (v6.5 linha 138; v6.14.5 linha 155)
if (device != null) {
    unknownByEndpoint.remove(connectionKey);
    device.checkDisabled();
```

```java
// org/traccar/model/Disableable.java  (idêntico em v6.5 e v6.14.5)
default void checkDisabled() throws SecurityException {
    if (getDisabled()) {
        throw new SecurityException(getClass().getSimpleName() + " is disabled");
    }
```

Ou seja: sessão não é criada, posição nenhuma é aceita. O aparelho volta pro estoque cego — e a tela de estoque, que classifica o item por `tc_devices.lastUpdate` ([stock-traccar.service.ts:220](../../../backend/src/modules/stock/stock-traccar.service.ts#L220)), passa a mostrá-lo como desconectado para sempre.

**F4 — A política da casa é "estoque inteiro cadastrado e comunicando no Traccar, com o IMEI como nome".**
Documentado no cabeçalho do [stock-traccar.service.ts:20-33](../../../backend/src/modules/stock/stock-traccar.service.ts#L20-L33): *"O device nasce com o IMEI como nome; ao ser vinculado, o `associate()` renomeia pra placa."* O `associate` de fato renomeia para a placa ([stock.service.ts:620-625](../../../backend/src/modules/stock/stock.service.ts#L620-L625)). Logo, o desvínculo tem que fazer o caminho de volta: **nome = IMEI, habilitado**. É exatamente o que o dono pediu — "volta pro estoque com seu número de IMEI normal".

**F5 — Carimbos e selos do ciclo anterior não são limpos.**
`uninstalledAt`/`uninstalledBy`/`uninstallReason` continuam no `Device` depois de reinstalar (o `associate` só toca `vehicleId`, `status`, `installedAt`, `installedBy`, `installedByTechnicianId`, `installLocation` — [stock.service.ts:571-580](../../../backend/src/modules/stock/stock.service.ts#L571-L580)). E o `StockItem` volta ao estoque com `validatedAt`/`validationOk`/`validationSnapshot` da instalação anterior, que a tela de estoque estampa como selo de conferência ([stock.service.ts:253-254](../../../backend/src/modules/stock/stock.service.ts#L253-L254)).

**F6 — Um `uniqueId` sintético para veículo sem rastreador já é padrão da casa.**
O sync do SGA cria veículo com `uniqueId = "HINOVA-" + codigoVeiculo` ([hinova-sync.service.ts:158](../../../backend/src/modules/hinova/hinova-sync.service.ts#L158)). Portanto usar `RETIRADO-<vehicleId>` na retirada não inventa convenção nova — segue a existente.

**F7 — Quem lê `Vehicle.uniqueId` (para não quebrar nada):** dedupe do sync do SGA ([hinova-sync.service.ts:163](../../../backend/src/modules/hinova/hinova-sync.service.ts#L163)), dedupe do `associate` ([stock.service.ts:506](../../../backend/src/modules/stock/stock.service.ts#L506)), guarda cross-tenant ([stock.service.ts:782](../../../backend/src/modules/stock/stock.service.ts#L782)), busca por dígitos em `/veiculos` ([vehicles.service.ts:63](../../../backend/src/modules/vehicles/vehicles.service.ts#L63)), índice de busca do mapa ([vehicle-search.ts:38](../../../frontend/dashboard/src/lib/vehicle-search.ts#L38)) e fallback de exibição do IMEI no painel de detalhe ([vehicle-detail-panel.tsx:79](../../../frontend/dashboard/src/components/vehicles/vehicle-detail-panel.tsx#L79)). Os cinco primeiros são buscas por igualdade ou por dígitos — um valor `RETIRADO-...` simplesmente não casa, que é o efeito desejado. O sexto exibe o valor na tela e precisa de guarda (Task 6).

**F8 — O alerta de OFFLINE não dispara para veículo sem rastreador.**
`detectOffline` filtra `traccarDeviceId: { not: null }` ([alerts.cron.ts:49-56](../../../backend/src/modules/alerts/alerts.cron.ts#L49-L56)). Como o `uninstall` zera esse campo, o veículo desvinculado não vira alerta fantasma. Nada a fazer aqui — verificado para não "corrigir" o que já está certo.

**F9 — A auditoria já cobre a ação.** O `AuditInterceptor` é global e registra todo método que não seja GET/HEAD/OPTIONS ([audit.interceptor.ts:13-33](../../../backend/src/modules/audit/audit.interceptor.ts#L13-L33)), então `POST /devices/:id/uninstall` já deixa rastro com usuário, IP e status. O motivo digitado fica em `Device.uninstallReason`. Nada a fazer.

**F10 — O item volta para o estoque disponível pela regra `associatedAt: null`.** É o filtro da listagem e dos cards de `/estoque` ([stock.service.ts:192-196](../../../backend/src/modules/stock/stock.service.ts#L192-L196) e [stock.service.ts:257-259](../../../backend/src/modules/stock/stock.service.ts#L257-L259)). O `uninstall` já faz isso — o IMEI do item nunca é alterado em nenhum momento do ciclo, então "voltar com o IMEI normal" é o comportamento atual e permanece.

---

## Decisões tomadas (e o que foi descartado)

| Decisão | Por quê |
|---|---|
| Liberar o `unique_id` com `RETIRADO-<vehicleId>` | Único por construção (é a PK do veículo), determinístico (testável sem relógio), sem migration, e segue o padrão `HINOVA-<codigo>` (F6). |
| Tornar `unique_id` nullable — **descartado** | Exigiria migration, mudança de tipo no Prisma (`String` → `String?`) e ajuste em todo consumidor (F7). Não é o mínimo que resolve. |
| Na retirada, **religar** o device no Traccar em vez de desabilitar | O estoque inteiro vive cadastrado e comunicando (F4); desabilitar deixa o aparelho cego (F3) e quebra a conferência antes da próxima instalação. |
| Renomear o device do Traccar de volta para o IMEI | Caminho inverso do que o `associate` faz (F4) e pedido explícito do dono. |
| **Veículo desvinculado sai de Clientes Ativos** (decisão do dono, 24/08/2026) | A tela filtrava só por `associateId != null`, então o carro continuava listado como ativo "sem rastreador". Ativo é veículo COM rastreador: desvinculou, o aparelho volta pro estoque e o veículo sai da lista. Listagem, contagem e resumo passam a usar `device: { is: { deletedAt: null } }` — a mesma régua, senão o cabeçalho conta o que a lista não mostra. O veículo continua existindo em `/veiculos` e volta pra cá sozinho quando receber outro rastreador. |
| Não mexer em `Vehicle.status`, `appAccessBlocked` nem no chip | Cancelamento comercial ≠ retirada física de equipamento. Misturar os dois aqui é escopo especulativo (Regra 8). O plano entrega exatamente o ciclo aparelho↔estoque. |
| Sem model de histórico de instalações | O `Device` guarda o último ciclo e o `AuditLog` guarda a ação (F9). Histórico ciclo-a-ciclo é outro plano. |

---

## Estrutura de arquivos

**Backend — criar:**

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/modules/devices/devices-uninstall.spec.ts` | Prova o contrato do desvínculo: libera o `unique_id`, religa e renomeia no Traccar, devolve o item limpo ao estoque |
| `backend/src/modules/stock/stock-reinstalacao-outro-veiculo.spec.ts` | Prova que o mesmo IMEI instala em outra placa/outro associado sem tocar no cadastro antigo, e que aparelho ainda preso a um veículo é recusado com mensagem clara |

**Backend — modificar:**

| Arquivo | Mudança |
|---|---|
| `backend/src/modules/devices/devices.service.ts` (método `uninstall`) | Libera `unique_id`; limpa selo de validação do `StockItem` e grava `traccarDeviceId`; troca `disabled: true` por `{ name: imei, disabled: false }` |
| `backend/src/modules/stock/stock.service.ts` (método `associate`) | Recusa IMEI ainda preso a outro veículo; grava `uniqueId: item.imei` também no braço do `update` do veículo; limpa os carimbos de retirada no `update` do device |

**Frontend — modificar:**

| Arquivo | Mudança |
|---|---|
| `frontend/dashboard/src/components/clientes/asset-card.tsx` | Botão "Desvincular rastreador" visível no rodapé do card |
| `frontend/dashboard/src/components/clientes/asset-actions-menu.tsx` | Remove o item duplicado do menu de três pontinhos |
| `frontend/dashboard/src/components/clientes/asset-dialogs.tsx` | Rótulos na língua do dono ("Desvincular") e texto que descreve o que de fato acontece |
| `frontend/dashboard/src/components/vehicles/vehicle-detail-panel.tsx` | Não exibir `unique_id` sintético como se fosse IMEI |

---

## Task 1: Desvínculo libera o IMEI que o veículo antigo segura

**Files:**
- Create: `backend/src/modules/devices/devices-uninstall.spec.ts`
- Modify: `backend/src/modules/devices/devices.service.ts` (dentro de `uninstall`, o bloco `if (vehicleId) { await tx.vehicle.update(...) }`)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `DevicesService.uninstall(deviceId: string, tenantId: string, options?: { reason?: string; by?: string })` passa a gravar `Vehicle.uniqueId = "RETIRADO-" + vehicleId`. A Task 4 depende desse formato para provar que o veículo antigo não é reencontrado pelo IMEI.

- [ ] **Step 1: Criar a branch de trabalho**

```bash
cd "c:/Users/damas/Documents/PROJETOS/21 GO/21 - RASTREAMENTO"
git checkout -b feat/desvinculo-rastreador
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `backend/src/modules/devices/devices-uninstall.spec.ts` com o conteúdo abaixo. Ele monta o `DevicesService` na mão (mesmo padrão de `devices.service.spec.ts`: o construtor recebe `prisma`, `traccarService`, `deviceRegistry`), e o `$transaction` do mock executa o callback com um `tx` falso.

```ts
import { DevicesService } from './devices.service';

/**
 * O ciclo "cliente cancelou → aparelho volta pro estoque → aparelho é
 * instalado em outro veículo" só fecha se o desvínculo soltar TUDO que prende
 * o rastreador ao dono antigo. Cada teste aqui é um desses vínculos.
 */
const IMEI = '866557084663055';
const TRACCAR_ID = 42;
const TENANT = '11111111-1111-1111-1111-111111111111';

const DEVICE = {
  id: 'dev-1',
  imei: IMEI,
  vehicleId: 'veh-1',
  traccarDeviceId: TRACCAR_ID,
  deletedAt: null,
};

function montar() {
  const tx = {
    device: { update: jest.fn().mockResolvedValue(DEVICE) },
    vehicle: { update: jest.fn().mockResolvedValue({ id: 'veh-1' }) },
    stockItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma: any = {
    device: { findFirst: jest.fn().mockResolvedValue(DEVICE) },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const traccar: any = { updateDevice: jest.fn().mockResolvedValue({}) };
  const registry: any = { notifyDeviceChanged: jest.fn() };
  const service = new DevicesService(prisma, traccar, registry);
  return { service, tx, traccar, registry };
}

describe('DevicesService.uninstall — o que o desvínculo precisa soltar', () => {
  it('libera o unique_id do veículo, senão o mesmo IMEI não instala em outra placa', async () => {
    const { service, tx } = montar();

    await service.uninstall('dev-1', TENANT, { reason: 'cliente cancelou' });

    expect(tx.vehicle.update).toHaveBeenCalledWith({
      where: { id: 'veh-1' },
      data: { traccarDeviceId: null, uniqueId: 'RETIRADO-veh-1' },
    });
  });

  it('solta o rastreador do veículo e carimba o motivo no histórico', async () => {
    const { service, tx } = montar();

    await service.uninstall('dev-1', TENANT, {
      reason: 'cliente cancelou',
      by: 'operador@21go',
    });

    const data = tx.device.update.mock.calls[0][0].data;
    expect(data.vehicleId).toBeNull();
    expect(data.status).toBe('DEACTIVATED');
    expect(data.uninstallReason).toBe('cliente cancelou');
    expect(data.uninstalledBy).toBe('operador@21go');
  });
});
```

- [ ] **Step 3: Rodar o teste e ver o primeiro caso falhar**

```bash
cd backend && npm test -- devices-uninstall
```

Esperado: o segundo teste passa (comportamento já existente) e o primeiro falha com algo como
`Expected: { data: { traccarDeviceId: null, uniqueId: "RETIRADO-veh-1" } }` / `Received: { data: { traccarDeviceId: null } }`.

- [ ] **Step 4: Implementar**

Em `backend/src/modules/devices/devices.service.ts`, dentro do `uninstall`, trocar o bloco:

```ts
      // Veículo sai do rastreamento — sem isso continuaria plotado no mapa com
      // a última posição congelada, o que é pior que não aparecer.
      if (vehicleId) {
        await tx.vehicle.update({
          where: { id: vehicleId },
          data: { traccarDeviceId: null },
        });
      }
```

por:

```ts
      // Veículo sai do rastreamento — sem isso continuaria plotado no mapa com
      // a última posição congelada, o que é pior que não aparecer.
      //
      // `unique_id` é UNIQUE global e guarda o IMEI do rastreador que estava
      // instalado. Enquanto o veículo antigo segurar esse número, instalar o
      // mesmo aparelho em outra placa encontra ESTE registro pelo IMEI e o
      // sobrescreve com a placa e o cliente novos (ou estoura a constraint no
      // create). O valor sintético segue o padrão que o sync do SGA já usa pra
      // veículo sem rastreador (`HINOVA-<codigo>`).
      if (vehicleId) {
        await tx.vehicle.update({
          where: { id: vehicleId },
          data: { traccarDeviceId: null, uniqueId: `RETIRADO-${vehicleId}` },
        });
      }
```

- [ ] **Step 5: Rodar o teste e ver passar**

```bash
cd backend && npm test -- devices-uninstall
```

Esperado: `Tests: 2 passed`.

- [ ] **Step 6: Rodar a suíte inteira do backend para garantir que nada quebrou**

```bash
cd backend && npm test
```

Esperado: nenhuma suíte nova em vermelho (o número de suítes passa a incluir `devices-uninstall.spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/devices/devices.service.ts backend/src/modules/devices/devices-uninstall.spec.ts
git commit -m "fix(devices): desvinculo libera o unique_id do veiculo pra o IMEI poder ser reinstalado"
```

---

## Task 2: Aparelho volta ao estoque comunicando, com o IMEI como nome no servidor GPS

**Files:**
- Modify: `backend/src/modules/devices/devices.service.ts` (bloco do Traccar dentro de `uninstall`, e o `tx.stockItem.updateMany`)
- Test: `backend/src/modules/devices/devices-uninstall.spec.ts` (adiciona casos ao arquivo da Task 1)

**Interfaces:**
- Consumes: `DevicesService.uninstall` da Task 1; `TraccarService.updateDevice(id: number, payload: Partial<TraccarDevice>): Promise<TraccarDevice>` ([traccar.service.ts:156](../../../backend/src/modules/traccar/traccar.service.ts#L156)).
- Produces: depois do desvínculo, o device no Traccar fica `{ name: <imei>, disabled: false }` e o `StockItem` do IMEI guarda `traccarDeviceId`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `describe` de `backend/src/modules/devices/devices-uninstall.spec.ts`:

```ts
  it('religa o device no servidor GPS e devolve o nome pro IMEI', async () => {
    const { service, traccar } = montar();

    await service.uninstall('dev-1', TENANT);

    // `disabled: true` fazia o Traccar recusar a sessão do rastreador
    // (ConnectionManager.getDeviceSession → Device.checkDisabled), ou seja: o
    // aparelho voltava pro estoque cego. E o nome tem que voltar a ser o IMEI,
    // que é como o estoque cadastra e reconhece o equipamento.
    expect(traccar.updateDevice).toHaveBeenCalledWith(TRACCAR_ID, {
      name: IMEI,
      disabled: false,
    });
  });

  it('devolve o item ao estoque disponível guardando o id do Traccar', async () => {
    const { service, tx } = montar();

    await service.uninstall('dev-1', TENANT);

    const chamada = tx.stockItem.updateMany.mock.calls[0][0];
    expect(chamada.where).toEqual({ tenantId: TENANT, imei: IMEI });
    expect(chamada.data).toMatchObject({
      associatedAt: null,
      deviceId: null,
      traccarDeviceId: TRACCAR_ID,
    });
  });

  it('não quebra o desvínculo quando o servidor GPS está fora', async () => {
    const { service, tx, traccar } = montar();
    traccar.updateDevice.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.uninstall('dev-1', TENANT)).resolves.toBeDefined();
    expect(tx.stockItem.updateMany).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && npm test -- devices-uninstall
```

Esperado: os dois primeiros novos testes falham (`updateDevice` foi chamado com `{ disabled: true }`; `data` não tem `traccarDeviceId`). O terceiro já passa — o bloco do Traccar hoje já está em `try/catch`; ele existe para travar uma regressão futura.

- [ ] **Step 3: Implementar — item de estoque**

Em `uninstall`, trocar:

```ts
      // Aparelho volta pro estoque disponível (a listagem filtra associatedAt).
      await tx.stockItem.updateMany({
        where: { tenantId, imei: device.imei },
        data: { associatedAt: null, deviceId: null },
      });
```

por:

```ts
      // Aparelho volta pro estoque disponível (a listagem filtra associatedAt).
      // O `traccarDeviceId` volta junto pra tela de estoque conseguir mostrar
      // sinal e posição na hora, sem esperar o cron do StockTraccarService.
      await tx.stockItem.updateMany({
        where: { tenantId, imei: device.imei },
        data: {
          associatedAt: null,
          deviceId: null,
          ...(device.traccarDeviceId
            ? { traccarDeviceId: device.traccarDeviceId }
            : {}),
        },
      });
```

- [ ] **Step 4: Implementar — servidor GPS**

Ainda em `uninstall`, trocar o bloco:

```ts
    // Traccar: mantém o device (histórico de posições) mas desabilitado, pra
    // não contar como ativo nem gerar alerta de offline eterno.
    if (device.traccarDeviceId) {
      try {
        await this.traccarService.updateDevice(device.traccarDeviceId, {
          disabled: true,
        });
      } catch (error) {
        this.logger.warn(
          `Retirada ${device.imei}: não consegui desabilitar no Traccar (${
            error instanceof Error ? error.message : error
          }).`,
        );
      }
    }
```

por:

```ts
    // Traccar: o device continua existindo (preserva o histórico de posições) e
    // volta ao estado de estoque — nome de novo igual ao IMEI e HABILITADO.
    //
    // Habilitado é obrigatório: `disabled: true` faz o Traccar recusar a sessão
    // do rastreador (`ConnectionManager.getDeviceSession` chama
    // `Device.checkDisabled()`, que lança SecurityException), então o aparelho
    // voltaria pro estoque sem comunicar e a conferência antes da próxima
    // instalação ficaria impossível. O estoque inteiro vive cadastrado e
    // comunicando no Traccar — ver StockTraccarService.
    if (device.traccarDeviceId) {
      try {
        await this.traccarService.updateDevice(device.traccarDeviceId, {
          name: device.imei,
          disabled: false,
        });
      } catch (error) {
        this.logger.warn(
          `Retirada ${device.imei}: não consegui devolver o device ao estado de estoque no Traccar (${
            error instanceof Error ? error.message : error
          }).`,
        );
      }
    }
```

- [ ] **Step 5: Rodar e ver passar**

```bash
cd backend && npm test -- devices-uninstall
```

Esperado: `Tests: 5 passed`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/devices/devices.service.ts backend/src/modules/devices/devices-uninstall.spec.ts
git commit -m "fix(devices): aparelho retirado volta ao estoque comunicando e com o IMEI como nome no Traccar"
```

---

## Task 3: Item volta ao estoque sem o selo de conferência do ciclo anterior

**Files:**
- Modify: `backend/src/modules/devices/devices.service.ts` (`tx.stockItem.updateMany` dentro de `uninstall`)
- Test: `backend/src/modules/devices/devices-uninstall.spec.ts`

**Interfaces:**
- Consumes: `uninstall` das Tasks 1 e 2.
- Produces: `StockItem` volta com `validatedAt`, `validatedById`, `validatedByName`, `validationOk`, `validationNotes`, `validationSnapshot` todos `null`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao `describe` de `backend/src/modules/devices/devices-uninstall.spec.ts`:

```ts
  it('apaga o selo de conferência da instalação anterior', async () => {
    const { service, tx } = montar();

    await service.uninstall('dev-1', TENANT);

    // O selo diz "este aparelho foi conferido no ato da instalação". Voltando
    // pro estoque com o selo do ciclo passado, o operador acha que o
    // equipamento que ficou meses num carro já foi testado — e ele não foi.
    expect(tx.stockItem.updateMany.mock.calls[0][0].data).toMatchObject({
      validatedAt: null,
      validatedById: null,
      validatedByName: null,
      validationOk: null,
      validationNotes: null,
      validationSnapshot: null,
    });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && npm test -- devices-uninstall
```

Esperado: falha com `Received` sem as chaves `validated*`.

- [ ] **Step 3: Implementar**

No mesmo `tx.stockItem.updateMany` da Task 2, o `data` final fica:

```ts
      await tx.stockItem.updateMany({
        where: { tenantId, imei: device.imei },
        data: {
          associatedAt: null,
          deviceId: null,
          // O selo de conferência vale para UMA instalação. Voltando ao
          // estoque com o selo antigo, o operador leria "já conferido" num
          // aparelho que passou meses em campo e ninguém testou na volta.
          validatedAt: null,
          validatedById: null,
          validatedByName: null,
          validationOk: null,
          validationNotes: null,
          validationSnapshot: null,
          ...(device.traccarDeviceId
            ? { traccarDeviceId: device.traccarDeviceId }
            : {}),
        },
      });
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && npm test -- devices-uninstall
```

Esperado: `Tests: 6 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/devices/devices.service.ts backend/src/modules/devices/devices-uninstall.spec.ts
git commit -m "fix(estoque): aparelho retirado volta sem o selo de conferencia do ciclo anterior"
```

---

## Task 4: Instalar o mesmo aparelho em outro veículo, de outro associado

**Files:**
- Create: `backend/src/modules/stock/stock-reinstalacao-outro-veiculo.spec.ts`
- Modify: `backend/src/modules/stock/stock.service.ts` (dentro da transação do `associate`: braço `update` do veículo e bloco do device)

**Interfaces:**
- Consumes: o formato `RETIRADO-<vehicleId>` da Task 1.
- Produces: `StockService.associate` passa a (a) recusar com `UnprocessableEntityException` quando o IMEI ainda está preso a outro veículo, nomeando o veículo ocupante; (b) gravar `uniqueId: item.imei` no veículo que recebe o aparelho; (c) limpar `uninstalledAt`/`uninstalledBy`/`uninstallReason` do device reinstalado.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/src/modules/stock/stock-reinstalacao-outro-veiculo.spec.ts`. O molde do mock é o de `stock-associate-rastreador-ocupado.spec.ts` (mesma ordem de dependências no construtor):

```ts
import { UnprocessableEntityException } from '@nestjs/common';
import { StockService } from './stock.service';
import type { HinovaLookupResult } from '../hinova/hinova.interface';

/**
 * Ciclo completo do aparelho: cliente cancelou, rastreador voltou pro estoque,
 * e agora ele vai pra OUTRA placa de OUTRO associado.
 *
 * O que este arquivo protege: o veículo do cliente antigo não pode ser
 * reaproveitado nem sobrescrito, e um aparelho que ainda está preso a um
 * veículo não pode ser instalado sem passar pelo desvínculo.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const IMEI = '866557084663055';
const CHEGOU_NA_GRAVACAO = 'CHEGOU-NA-GRAVACAO';

const LOOKUP_NOVO: HinovaLookupResult = {
  encontrado: true,
  ativo: true,
  fonte: 'sga',
  cliente: { nome: 'MARIA DE SOUZA', cpf: '12444501705' },
  veiculo: {
    placa: 'QNM6G46',
    chassi: '9BWAA05U7BT183999',
    codigoModelo: '4888',
    modelo: 'FIORINO FURGAO EVO 1.4',
    codigoVeiculo: '30999',
  },
  situacao: {
    codigo: '1',
    descricao: 'ATIVO',
    financeira: 'ADIMPLENTE',
    dataVencimento: '2026-09-10',
  },
};

const DTO = {
  placa: 'QNM6G46',
  technicianName: 'Técnico Teste',
  installLocation: 'atrás do porta-luvas',
};

/**
 * `deviceExistente`: o Device do IMEI que já existe no banco (o aparelho já
 * rodou antes). `vehiclePorBusca`: o que o dedupe do associate encontra.
 */
function servico(opcoes: {
  deviceExistente: { id: string; imei: string; vehicleId: string | null } | null;
  vehiclePorBusca: { id: string; plate: string; chassi: string | null; hinovaCode: string | null } | null;
}) {
  const tx = {
    associate: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'assoc-novo' }),
    },
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(opcoes.vehiclePorBusca),
      update: jest.fn().mockResolvedValue(opcoes.vehiclePorBusca),
      create: jest.fn().mockResolvedValue({ id: 'veh-novo', plate: 'QNM6G46' }),
    },
    device: {
      findFirst: jest.fn().mockImplementation(({ where }) => {
        // Busca "quem já está neste veículo" x busca "quem já usa este IMEI".
        if (where.vehicleId) return Promise.resolve(null);
        return Promise.resolve(opcoes.deviceExistente);
      }),
      update: jest.fn().mockRejectedValue(new Error(CHEGOU_NA_GRAVACAO)),
      create: jest.fn().mockRejectedValue(new Error(CHEGOU_NA_GRAVACAO)),
    },
    stockItem: { update: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    stockItem: {
      findFirst: jest.fn().mockResolvedValue({ id: 'item-1', imei: IMEI }),
    },
    vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
    device: { findFirst: jest.fn().mockResolvedValue(null) },
    installationPending: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest
      .fn()
      .mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  };

  const s = new StockService(
    prisma as never,
    { lookupByPlate: jest.fn().mockResolvedValue(LOOKUP_NOVO) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { lookupNoEspelho: jest.fn().mockResolvedValue(null) } as never,
    {
      lookup: jest.fn().mockResolvedValue(null),
      contato: jest.fn().mockResolvedValue(null),
    } as never,
    {} as never,
    {} as never,
  );
  return { s, tx };
}

describe('StockService.associate — aparelho que voltou do estoque', () => {
  it('cria o veículo novo em vez de reaproveitar o do cliente antigo', async () => {
    // Depois do desvínculo, o veículo antigo guarda RETIRADO-<id>, então o
    // dedupe por uniqueId não casa com o IMEI e a busca não devolve nada.
    const { s, tx } = servico({
      deviceExistente: { id: 'dev-1', imei: IMEI, vehicleId: null },
      vehiclePorBusca: null,
    });

    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      CHEGOU_NA_GRAVACAO,
    );

    expect(tx.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plate: 'QNM6G46', uniqueId: IMEI }),
      }),
    );
    expect(tx.vehicle.update).not.toHaveBeenCalled();
  });

  it('recusa o IMEI que ainda está preso a outro veículo, nomeando o ocupante', async () => {
    const { s, tx } = servico({
      deviceExistente: { id: 'dev-1', imei: IMEI, vehicleId: 'veh-antigo' },
      vehiclePorBusca: null,
    });

    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      /desvincul/i,
    );
    expect(tx.device.update).not.toHaveBeenCalled();
    expect(tx.device.create).not.toHaveBeenCalled();
  });

  it('quando o veículo já existe (mesma placa), grava o IMEI atual no unique_id', async () => {
    const { s, tx } = servico({
      deviceExistente: { id: 'dev-1', imei: IMEI, vehicleId: null },
      vehiclePorBusca: {
        id: 'veh-existente',
        plate: 'QNM6G46',
        chassi: null,
        hinovaCode: null,
      },
    });

    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      CHEGOU_NA_GRAVACAO,
    );

    expect(tx.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'veh-existente' },
        data: expect.objectContaining({ uniqueId: IMEI }),
      }),
    );
  });

  it('limpa os carimbos de retirada do device reinstalado', async () => {
    const { s, tx } = servico({
      deviceExistente: { id: 'dev-1', imei: IMEI, vehicleId: null },
      vehiclePorBusca: null,
    });
    tx.device.update.mockResolvedValue({ id: 'dev-1' });
    tx.stockItem.update.mockRejectedValue(new Error(CHEGOU_NA_GRAVACAO));

    await expect(s.associate('item-1', TENANT, DTO)).rejects.toThrow(
      CHEGOU_NA_GRAVACAO,
    );

    expect(tx.device.update.mock.calls[0][0].data).toMatchObject({
      uninstalledAt: null,
      uninstalledBy: null,
      uninstallReason: null,
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && npm test -- stock-reinstalacao-outro-veiculo
```

Esperado: 4 testes, os 3 últimos falham (`update` do veículo sem `uniqueId`; nenhuma recusa quando o device está preso a outro veículo; `data` do device sem os campos `uninstall*`). O primeiro já passa depois da Task 1.

- [ ] **Step 3: Implementar — veículo existente recebe o IMEI atual**

Em `backend/src/modules/stock/stock.service.ts`, no braço `if (vehicle) { vehicle = await tx.vehicle.update(...) }`, acrescentar `uniqueId` ao `data`:

```ts
      if (vehicle) {
        vehicle = await tx.vehicle.update({
          where: { id: vehicle.id },
          data: {
            plate: placa,
            // `unique_id` acompanha o rastreador que está no carro agora. Sem
            // isto, um veículo que já existia (criado pelo sync do SGA com
            // `HINOVA-<codigo>`, ou que teve o aparelho trocado) ficaria pra
            // sempre com o número de outro equipamento — e a busca por IMEI
            // na tela de veículos não acharia o carro.
            uniqueId: item.imei,
            chassi: lookup.veiculo.chassi ?? vehicle.chassi,
            model: lookup.veiculo.modelo ?? vehicle.model,
            status: 'ACTIVE',
            associateId: associate.id,
            hinovaCode: lookup.veiculo.codigoVeiculo ?? vehicle.hinovaCode,
            lastSync: new Date(),
            ...situacaoSga,
          },
        });
      } else {
```

- [ ] **Step 4: Implementar — recusar aparelho ainda preso a outro veículo e limpar os carimbos**

No mesmo arquivo, o bloco que resolve o `existingDevice` passa a ser:

```ts
      const existingDevice = await tx.device.findFirst({
        where: { imei: item.imei, tenantId },
      });

      // Espelho da checagem de placa ocupada: o aparelho só pode entrar num
      // veículo novo se não estiver preso a outro. Sem isto, o `update` abaixo
      // arrancaria o rastreador do carro alheio em silêncio — o dono antigo
      // sumiria do mapa sem ninguém saber por quê.
      if (
        existingDevice?.vehicleId &&
        existingDevice.vehicleId !== vehicle.id
      ) {
        const ocupado = await tx.vehicle.findFirst({
          where: { id: existingDevice.vehicleId },
          select: { plate: true },
        });
        throw new UnprocessableEntityException(
          `O rastreador IMEI ${item.imei} ainda está instalado ` +
            `${ocupado?.plate ? `na placa ${ocupado.plate}` : 'em outro veículo'}. ` +
            'Desvincule o rastreador antes de instalar em outro veículo.',
        );
      }

      const device = existingDevice
        ? await tx.device.update({
            where: { id: existingDevice.id },
            data: {
              vehicleId: vehicle.id,
              status: 'INSTALLED',
              installedAt: new Date(),
              installedBy: technicianName,
              installedByTechnicianId: dto.technicianId ?? null,
              installLocation,
              // Aparelho reinstalado não pode carregar a data e o motivo da
              // retirada anterior — o cadastro diria "retirado" com o
              // equipamento em campo.
              uninstalledAt: null,
              uninstalledBy: null,
              uninstallReason: null,
            },
          })
        : await tx.device.create({
```

O `tx.vehicle.findFirst` usado na mensagem precisa existir no mock do teste — ele já está declarado no `servico()` acima (`vehicle.findFirst`), e retorna `vehiclePorBusca`; para o caso da recusa, isso devolve `null` e a mensagem cai no ramo "em outro veículo", que é o que o teste verifica pelo `/desvincul/i`.

- [ ] **Step 5: Rodar e ver passar**

```bash
cd backend && npm test -- stock-reinstalacao-outro-veiculo
```

Esperado: `Tests: 4 passed`.

- [ ] **Step 6: Rodar a suíte inteira (o `associate` é o coração do estoque)**

```bash
cd backend && npm test
```

Esperado: tudo verde, incluindo `stock-associate-rastreador-ocupado.spec.ts`, `stock-associate-inativo.spec.ts` e `stock-lookup.spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/stock/stock.service.ts backend/src/modules/stock/stock-reinstalacao-outro-veiculo.spec.ts
git commit -m "fix(estoque): rastreador reinstalado em outro veiculo nao sobrescreve o cadastro do cliente antigo"
```

---

## Task 5: Botão "Desvincular rastreador" visível no card, sem abrir o menu

**Files:**
- Modify: `frontend/dashboard/src/components/clientes/asset-card.tsx`
- Modify: `frontend/dashboard/src/components/clientes/asset-actions-menu.tsx`
- Modify: `frontend/dashboard/src/components/clientes/asset-dialogs.tsx`

**Interfaces:**
- Consumes: `devicesApi.uninstall(id: string, reason?: string)` ([api.ts:441](../../../frontend/dashboard/src/lib/api.ts#L441)) e o handler `confirmarRetirada` já existente em [clientes/page.tsx:162](<../../../frontend/dashboard/src/app/(dashboard)/clientes/page.tsx#L162>). Nenhuma mudança na página é necessária: ela já passa `onRetirar` para o `AssetCard`.
- Produces: nada consumido por tasks posteriores.

- [ ] **Step 1: Colocar o botão no rodapé do card**

Em `frontend/dashboard/src/components/clientes/asset-card.tsx`:

1. Acrescentar aos imports de `lucide-react` o ícone `PackageOpen`;
2. Acrescentar, logo abaixo dos imports existentes, `import { Button } from '@/components/ui/button';`
3. Trocar o rodapé:

```tsx
      {/* Rodapé: frescor do dado + situação no SGA */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {textoUltimaAtualizacao(asset)}
        </span>
        {asset.sga.code && (
          <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">
            SGA: {asset.sga.code}
            {asset.sga.statusLabel ? ` · ${asset.sga.statusLabel}` : ''}
          </span>
        )}
      </div>
```

por:

```tsx
      {/* Rodapé: frescor do dado, situação no SGA e a ação que o atendimento
          mais usa quando o cliente cancela. Ela fica à vista porque estava
          escondida atrás do menu de três pontinhos — dois cliques pra uma
          operação de rotina. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {textoUltimaAtualizacao(asset)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {asset.sga.code && (
            <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">
              SGA: {asset.sga.code}
              {asset.sga.statusLabel ? ` · ${asset.sga.statusLabel}` : ''}
            </span>
          )}
          {asset.device && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetirar}
              className="h-7 gap-1.5 border-red-500/30 px-2.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <PackageOpen className="h-3.5 w-3.5" />
              Desvincular rastreador
            </Button>
          )}
        </div>
      </div>
```

- [ ] **Step 2: Tirar a ação duplicada do menu de três pontinhos**

Em `frontend/dashboard/src/components/clientes/asset-actions-menu.tsx`, remover o separador e o item de retirada (do `<DropdownMenuSeparator />` que precede até o `</DropdownMenuItem>` do "Retirar rastreador"):

```tsx
        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          onClick={onRetirar}
          disabled={!asset.device}
        >
          <PackageOpen className="h-4 w-4" /> Retirar rastreador
        </DropdownMenuItem>
```

Depois:
- remover `onRetirar` das props do componente (declaração e tipo);
- remover `PackageOpen` dos imports de `lucide-react` deste arquivo;
- em `asset-card.tsx`, remover `onRetirar={onRetirar}` do `<AssetActionsMenu ... />` (a prop continua existindo no `AssetCard`, que agora é quem usa).

- [ ] **Step 3: Ajustar o texto do diálogo para a língua do dono e para o que de fato acontece**

Em `frontend/dashboard/src/components/clientes/asset-dialogs.tsx`, dentro de `RetirarRastreadorDialog`:

```tsx
          <DialogTitle>Desvincular rastreador</DialogTitle>
```

e trocar o aviso âmbar por:

```tsx
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm text-amber-200">
          O veículo deixa de ser rastreado imediatamente e o aparelho volta pro
          estoque disponível, com o mesmo IMEI e continuando a comunicar — nada
          é enviado ao rastreador. O histórico de posições é preservado.
        </p>
```

e o botão de confirmação:

```tsx
            Confirmar desvínculo
```

- [ ] **Step 4: Conferir que compila e passa no lint**

```bash
cd frontend/dashboard && npm run lint && npm run build
```

Esperado: lint sem erro e build concluído (`Compiled successfully`). Se o lint reclamar de `onRetirar` não usado em `asset-actions-menu.tsx`, é porque o Step 2 deixou a prop pra trás — remover.

- [ ] **Step 5: Conferir na tela, com o backend local rodando**

```bash
docker compose -f docker/docker-compose.yml up -d
cd backend && npm run start:dev
# noutro terminal:
cd frontend/dashboard && npm run dev
```

Abrir `http://localhost:3000/clientes`, aba de ativos. Esperado: cada card com rastreador mostra o botão vermelho "Desvincular rastreador" no rodapé, ao lado do selo do SGA; o menu de três pontinhos não tem mais o item; cards sem rastreador não mostram o botão.

- [ ] **Step 6: Commit**

```bash
git add frontend/dashboard/src/components/clientes
git commit -m "feat(clientes): botao de desvincular rastreador direto no card, sem abrir o menu"
```

---

## Task 6: `unique_id` sintético não pode aparecer como se fosse IMEI

**Files:**
- Modify: `frontend/dashboard/src/components/vehicles/vehicle-detail-panel.tsx`

**Interfaces:**
- Consumes: o formato `RETIRADO-<vehicleId>` da Task 1.
- Produces: nada.

- [ ] **Step 1: Implementar a guarda**

Em `frontend/dashboard/src/components/vehicles/vehicle-detail-panel.tsx`, trocar:

```tsx
  const imei = showInstallLocation
    ? vehicle.device?.imei?.trim() || vehicle.uniqueId?.trim() || null
    : null;
```

por:

```tsx
  // `uniqueId` é rede de segurança quando o Device não veio no payload, mas ele
  // também guarda valores sintéticos pra veículo sem rastreador
  // (`RETIRADO-<id>` depois do desvínculo, `HINOVA-<codigo>` no sync do SGA).
  // Só serve como IMEI quando é o número mesmo.
  const uniqueIdComoImei = /^\d{6,}$/.test(vehicle.uniqueId?.trim() ?? '')
    ? vehicle.uniqueId.trim()
    : null;
  const imei = showInstallLocation
    ? vehicle.device?.imei?.trim() || uniqueIdComoImei
    : null;
```

- [ ] **Step 2: Conferir que compila**

```bash
cd frontend/dashboard && npm run lint && npm run build
```

Esperado: sem erro.

- [ ] **Step 3: Commit**

```bash
git add frontend/dashboard/src/components/vehicles/vehicle-detail-panel.tsx
git commit -m "fix(veiculos): identificador sintetico de veiculo sem rastreador nao e exibido como IMEI"
```

---

## Task 7: Ensaio do ciclo completo em ambiente local

Testes unitários provam o contrato do código; este ensaio prova o fluxo com Postgres e Traccar de verdade. **Nada aqui toca produção.**

**Files:** nenhum arquivo alterado — é verificação.

- [ ] **Step 1: Subir o ambiente local**

```bash
cd "c:/Users/damas/Documents/PROJETOS/21 GO/21 - RASTREAMENTO"
docker compose -f docker/docker-compose.yml up -d
cd backend && npx prisma migrate deploy && npx prisma db seed && npm run start:dev
```

Esperado: backend em `http://localhost:3001`, Traccar em `http://localhost:8082`.

- [ ] **Step 2: Autenticar e guardar o token**

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@rastreamento21go.com.br","password":"admin123"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])")
echo "${TOKEN:0:12}..."
```

Esperado: um prefixo de JWT. Se vier vazio, conferir o formato da resposta com `curl ... | head -c 400` e ajustar o caminho da chave.

- [ ] **Step 3: Anotar o estado ANTES do desvínculo**

```bash
DEV=<id-do-device-instalado>
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/v1/devices/$DEV" | python -m json.tool | head -30
```

Anotar: `imei`, `vehicleId`, `traccarDeviceId`, `status`.

- [ ] **Step 4: Desvincular**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"reason":"ensaio local"}' \
  "http://localhost:3001/api/v1/devices/$DEV/uninstall" | python -m json.tool | head -20
```

Esperado: `vehicleId: null`, `status: "DEACTIVATED"`, `uninstallReason: "ensaio local"`.

- [ ] **Step 5: Provar que o veículo soltou o IMEI e que o aparelho está no estoque**

```bash
docker exec -it r21go-postgres psql -U postgres -d rastreamento21go -c \
  "select plate, unique_id, traccar_device_id from vehicles where unique_id like 'RETIRADO-%';"

curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/v1/stock?search=<imei>" | python -m json.tool | head -30
```

Esperado: a linha do veículo com `unique_id = RETIRADO-<uuid>` e `traccar_device_id` nulo; o IMEI aparecendo na listagem do estoque, com `associatedAt: null` e `validatedAt: null`.

- [ ] **Step 6: Provar que o device no Traccar voltou ao estado de estoque**

```bash
curl -s -u admin@teste.local:<senha-do-traccar-local> \
  "http://localhost:8082/api/devices?uniqueId=<imei>" | python -m json.tool
```

Esperado: `"name": "<imei>"` e `"disabled": false`.

- [ ] **Step 7: Instalar o mesmo aparelho em outro veículo**

Pelo painel local (`/estoque` → item → "Associar (SGA)") com uma placa diferente, ou via API:

```bash
ITEM=<id-do-stock-item>
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"placa":"<outra-placa>","technicianName":"Ensaio","installLocation":"teste"}' \
  "http://localhost:3001/api/v1/stock/$ITEM/associate" | python -m json.tool
```

Esperado: `ok: true` com `vehicleId` **diferente** do anotado no Step 3.

- [ ] **Step 8: Provar que o cadastro do cliente antigo continua intacto**

```bash
docker exec -it r21go-postgres psql -U postgres -d rastreamento21go -c \
  "select v.plate, v.unique_id, a.name from vehicles v left join associates a on a.id = v.associate_id where v.unique_id in ('<imei>') or v.unique_id like 'RETIRADO-%';"
```

Esperado: duas linhas — o veículo antigo com `RETIRADO-<uuid>` e o **nome do associado antigo**, e o veículo novo com o IMEI e o nome do associado novo. Se aparecer uma linha só, ou o nome do cliente novo na linha antiga, **parar**: a Task 1 ou a Task 4 não está no ar.

- [ ] **Step 9: Registrar o resultado**

Anotar no PR (ou no SessionLog do dia) as saídas dos Steps 5, 6 e 8. Sem essas três provas, o ciclo não está verificado.

---

## Evidências do ensaio (executado em 24/08/2026, ambiente local)

Ciclo completo rodado contra Postgres 16 e Traccar 6.14.5 em container, pelo caminho real da API.

**Instalação no cliente A** — `POST /stock/<item>/associate` com a placa `ADW0Z41`:

```
 plate   | unique_id       | traccar_device_id | dono       | imei            | status
 ADW0Z41 | 869999000000001 | 2                 | João Silva | 869999000000001 | INSTALLED
TRACCAR: [{'id': 2, 'name': 'ADW0Z41', 'disabled': False}]
```

**Depois do desvínculo** — `POST /devices/<id>/uninstall`:

```
 plate   | unique_id                                     | traccar_device_id | dono
 ADW0Z41 | RETIRADO-4d5d14ed-8449-4fcc-a500-5ecb45b83331 |                   | João Silva

 imei            | no_estoque | sem_device | selo_limpo | snapshot_limpo | traccar_device_id
 869999000000001 | t          | t          | t          | t              | 2
```

**Reinstalação no cliente B** — mesmo item, placa `ADX6H87`, sem erro e com veículo novo:

```
 plate   | unique_id                | dono         | imei            | status    | sem_carimbo_retirada
 ADW0Z41 | RETIRADO-4d5d14ed-...    | João Silva   |                 |           | t
 ADX6H87 | 869999000000001          | Maria Santos | 869999000000001 | INSTALLED | t
```

Os dois cadastros coexistem: o cliente antigo continua no lugar dele, sem rastreador; o novo ficou com o aparelho.

**Clientes Ativos só mostra quem tem rastreador** (52 veículos com cliente no banco, 1 com aparelho instalado):

```
CLIENTES ATIVOS -> total: 1
   ADX6H87 | Maria Santos | IMEI 869999000000001
cabecalho (summary): 1

# depois de desvincular:
CLIENTES ATIVOS -> total: 0
ESTOQUE -> total: 1 [('869999000000001', 'disponivel')]
```

**Segundo desvínculo** — device no Traccar de volta ao estado de estoque:

```
TRACCAR: [{'id': 2, 'name': '869999000000001', 'uniqueId': '869999000000001', 'disabled': False}]
```

### Dois defeitos que só o ensaio pegou

1. **`PUT /devices/{id}` do Traccar recusa payload parcial (HTTP 400).** A primeira versão mandava só `{ name, disabled }` e o Traccar respondia 400 porque `uniqueId` é obrigatório — o desvínculo terminava com um `WARN` no log e o device continuava com o nome da placa. Corrigido lendo o device (`getDevice`) e sobrescrevendo só o que muda, mesmo padrão do `StockService.associate`.
2. **`docker/traccar/traccar.xml` tinha `web.path = ./modern`**, pasta que não existe nem na 6.5 nem na 6.14.5 — o container morre no boot com `NoSuchFileException` e nunca chega a responder. Corrigido para `./web`. Vale conferir a mesma linha no `traccar.xml` de produção antes do upgrade 6.5 → 6.14.5.

---

## Task 8: Deploy em produção

Ler antes de começar: `docs/DEPLOY.md` seção 5 e a memória `feedback_deploy_via_registry` (o `git push` **não** dispara build; `docker build` + `service update` sem `push` pro registry **não** atualiza o container).

- [ ] **Step 1: Baseline — produção está de pé ANTES de mexer**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://trackgo.site
curl -s https://api.trackgo.site/api/v1/health | python -m json.tool
```

Esperado: `200` e um health com `gitSha`/`buildTime`. Anotar o `gitSha` atual — é o que provará que o deploy trocou o código.

- [ ] **Step 2: Merge e push**

```bash
git checkout main && git merge --no-ff feat/desvinculo-rastreador
git push origin main
```

- [ ] **Step 3: Build do backend no droplet (sozinho, sem nada em paralelo)**

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 "cd /root/RASTREAMENTO-21-GO && git pull origin main && \
  docker build --provenance=false --sbom=false -t r21go-backend:latest -f backend/Dockerfile backend/ && \
  docker tag r21go-backend:latest localhost:5000/r21go-backend:latest && \
  docker push localhost:5000/r21go-backend:latest"
```

Esperado: `Successfully built` e o push terminando com um `digest: sha256:...`. Build lento é normal; **não** disparar de novo.

- [ ] **Step 4: Atualizar o service pelo digest e provar que a task foi recriada**

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 \
  "docker service update --force --image \"\$(docker image inspect localhost:5000/r21go-backend:latest --format '{{index .RepoDigests 0}}')\" rastreamento-21-go_backend-rastreamento && \
   docker service ps rastreamento-21-go_backend-rastreamento --format '{{.Name}} | {{.CurrentState}}' | head -3"
```

Esperado: a primeira linha em `Running <segundos> ago`. Se disser "Running 11 hours ago", o Swarm não recriou — repetir com o digest explícito.

- [ ] **Step 5: Provar que o código novo está dentro do container**

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 \
  "CID=\$(docker ps -q -f name=rastreamento-21-go_backend-rastreamento | head -1); \
   docker exec \$CID grep -c 'RETIRADO-' /app/dist/src/modules/devices/devices.service.js; \
   docker exec \$CID grep -c 'Desvincule o rastreador antes' /app/dist/src/modules/stock/stock.service.js"
```

Esperado: dois números `>= 1`. Se der `0`, o registry não foi atualizado — voltar ao Step 3.

- [ ] **Step 6: Build do frontend (só depois que o backend terminou)**

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 "cd /root/RASTREAMENTO-21-GO && \
  docker build --provenance=false --sbom=false -t r21go-frontend:latest \
    --build-arg NEXT_PUBLIC_API_URL=https://api.trackgo.site \
    --build-arg NEXT_PUBLIC_WS_URL=https://api.trackgo.site \
    --build-arg NEXT_PUBLIC_TRACCAR_URL=https://traccar.trackgo.site \
    --build-arg NEXT_PUBLIC_MAPTILER_KEY=\$MAPTILER_KEY \
    -f frontend/dashboard/Dockerfile frontend/dashboard/ && \
  docker tag r21go-frontend:latest localhost:5000/r21go-frontend:latest && \
  docker push localhost:5000/r21go-frontend:latest"
```

A chave do MapTiler está no `.env.local` da raiz do projeto (mesmo lugar do `EXPO_TOKEN`) — procurar lá antes de pedir ao dono. **Sem os `--build-arg`, o bundle sobe com baseURL relativo e todo o painel dá 404.**

- [ ] **Step 7: Atualizar o service do frontend e validar o bundle**

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 \
  "docker service update --force --image \"\$(docker image inspect localhost:5000/r21go-frontend:latest --format '{{index .RepoDigests 0}}')\" rastreamento-21-go_frontend-rastreamento"

curl -s https://trackgo.site/_next/static/chunks/*.js | grep -oE 'baseURL:"[^"]*"' | head -2
```

Esperado: `baseURL:"https://api.trackgo.site/api/v1"`.

- [ ] **Step 8: Verificação final (as três, não só uma)**

```bash
curl -s -o /dev/null -w "dashboard %{http_code}\n" https://trackgo.site
curl -s https://api.trackgo.site/api/v1/health | python -m json.tool | grep -E 'gitSha|uptimeSeconds'
```

Esperado: `200`, `gitSha` **diferente** do anotado no Step 1 e `uptimeSeconds` baixo. Depois abrir `https://trackgo.site/clientes` e confirmar o botão "Desvincular rastreador" no rodapé dos cards.

- [ ] **Step 9: Ensaio real com um aparelho de teste**

Escolher um ativo de teste (nunca um cliente real na primeira vez), desvincular pelo botão, e conferir:

1. `/estoque` mostra o IMEI de volta na lista de disponíveis;
2. o card do estoque mostra o aparelho comunicando (se o rastreador ainda estiver energizado);
3. `traccar.trackgo.site` mostra o device com o nome igual ao IMEI e habilitado;
4. instalar o mesmo aparelho em outra placa pelo fluxo normal do estoque e confirmar que o cliente antigo continua no lugar dele em `/clientes`.

- [ ] **Step 10: Documentar**

Atualizar `docs/PLANO-PRODUCAO-ZERO-ERRO.md` marcando o P1.7 como concluído com a data e um resumo de uma linha do que passou a valer (device volta habilitado e com nome de IMEI; `unique_id` liberado). Commitar com `docs(plano): P1.7 concluido — ciclo de desvinculo e reinstalacao fechado`.

---

## Riscos e o que fazer se acontecer

| Risco | Sinal | O que fazer |
|---|---|---|
| Existe veículo em produção segurando um IMEI de aparelho que já voltou ao estoque (retirada feita antes deste plano) | `select plate, unique_id from vehicles v where exists (select 1 from stock_items s where s.imei = v.unique_id and s.associated_at is null);` retorna linhas | Rodar o mesmo `update` que a Task 1 faz, um a um: `update vehicles set unique_id = 'RETIRADO-' || id where id = '<uuid>';`. Fazer **depois** do deploy, com o resultado da query salvo antes. |
| Aparelho retirado antes deste plano continua `disabled: true` no Traccar | Item no estoque nunca comunica, mesmo energizado | Reabilitar pela UI do Traccar ou por `PUT /api/devices/<id>` com `disabled: false` e `name` igual ao IMEI. Listar os candidatos com `GET /api/devices` filtrando `disabled: true`. |
| O operador desvincula por engano | Cliente reclama que sumiu do mapa | Reinstalar pelo `/estoque` → "Associar (SGA)" com a mesma placa. O histórico de posições nunca é apagado; o veículo volta a ser plotado assim que o vínculo é refeito. |
| Aparelho continua transmitindo do carro do ex-cliente até a retirada física | Item no estoque aparece no mapa na casa do ex-associado | É intencional e útil (é assim que se acha o equipamento pra recolher). Se incomodar, o item pode ser marcado como perdido — assunto de outro plano. |

---

## Self-review

**Cobertura do pedido do dono:**

| Pedido | Task |
|---|---|
| "desvincular ele daquele associado" | 1 (solta o `unique_id`) + o `uninstall` que já existia |
| "esse mesmo aparelho voltar para o estoque" | 2 e 3 (volta comunicando, com o IMEI como nome, sem selo velho) |
| "para eu instalar em outro veículo" | 4 (cria o veículo novo, não sobrescreve o antigo; recusa aparelho ainda preso) |
| "botão prático sem precisar clicar nos 3 pontinhos" | 5 |
| "volta com o número de IMEI normal, o IMEI aponta pro IP, nada muda dessa parte" | 2 (nome volta a ser o IMEI; nenhum comando é enviado ao rastreador — está nas Global Constraints) e F10 (o IMEI do item nunca é alterado) |
| "não aceito achismo" | Seção Fundamentos, com arquivo:linha de cada afirmação e o código-fonte do Traccar nas duas versões |

**Placeholders:** nenhum passo diz "tratar erros adequadamente" ou "escrever testes" sem mostrar o código. Todos os blocos de código são o conteúdo final.

**Consistência de nomes:** `RETIRADO-${vehicleId}` aparece igual nas Tasks 1, 4, 6, 7 e nos riscos. `uninstall(deviceId, tenantId, { reason, by })` é a assinatura usada em todos os testes e é a que já existe no controller. `updateDevice(id, { name, disabled })` bate com a assinatura real do `TraccarService`.
