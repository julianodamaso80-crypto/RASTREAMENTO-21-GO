# Worker da K-Tag na rede Find My — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer para o 21 GO a posição das K-Tags reportada pela rede Apple Find My, com ritmo acelerado automaticamente quando o rastreador principal do mesmo veículo é neutralizado.

**Architecture:** O backend decide, o worker obedece. Um serviço Python isolado consulta a rede Find My saindo por proxy residencial, e entrega os relatórios na rota `POST /ble-tags/sightings` que já existe. Toda a regra de negócio (quais TAGs buscar, com que intervalo, quanto histórico) vive no backend e é servida por `GET /ble-tags/polling-plan`.

**Tech Stack:** NestJS 11 + Prisma (backend, já existente), Python 3.12 + FindMy.py 0.10.1 (worker novo), pytest, Jest.

## Global Constraints

- **Multi-tenant sem exceção.** Toda query do backend filtra por `tenantId` vindo do JWT (`req.tenantId`). O plano de polling nunca carrega `tenantId` no corpo — o worker opera dentro de um único tenant.
- **Soft delete.** Consultas a `Device` sempre filtram `deletedAt: null`.
- **Imports do Prisma Client usam `.prisma/client`**, nunca `@prisma/client`.
- **Migrations são aditivas**, com nome no padrão `YYYYMMDDHHMMSS_descricao`, escritas à mão em SQL. Nunca `drizzle-kit push` nem `prisma db push` contra banco existente.
- **Nunca commitar segredo.** Chave privada de TAG, token do worker e credencial de proxy ficam em variável de ambiente e no 1Password. `.env` do worker é git-ignored; só `.env.example` entra no repo.
- **Roles em inglês, UI em PT-BR.**
- **`seenAt` é o carimbo que vale.** Momento em que a TAG foi vista. `createdAt` é quando gravamos, serve para auditoria e nunca para decidir onde o veículo está. Repetir aqui a confusão entre `fixTime` e `lastUpdate` mandaria a equipe para onde o carro esteve.
- **Nenhuma tela apresenta posição de TAG como tempo real.** Sempre com a idade explícita.
- Os modelos BLE são exatamente `BLE_KTAG`, `BLE_REDTAG`, `BLE_AIRTAG_GENERIC` (constante `BLE_DEVICE_MODELS` já existe em `ble-tags.service.ts`).
- Rodar os testes do backend a partir de `backend/`: `npx jest <caminho>`.
- O scanner BLE local (`poc-ktag-findmy/scanner/scan_ble.py`) já está em uso e posta sem `seenAt` nem `accuracy`. **Nada neste plano pode quebrá-lo.**

---

## File Structure

**Backend (modificar):**
- `backend/prisma/schema.prisma` — colunas novas em `Device` e `BleSighting`
- `backend/prisma/migrations/20260820120000_ktag_findmy/migration.sql` — migration aditiva
- `backend/src/modules/ble-tags/dto/create-sighting.dto.ts` — `rssi` opcional, `seenAt` e `accuracy` novos
- `backend/src/modules/ble-tags/ble-tags.service.ts` — grava os campos novos; ganha `getPollingPlan` e `acionarTurbo`
- `backend/src/modules/ble-tags/ble-tags.controller.ts` — rotas novas

**Backend (criar):**
- `backend/src/modules/ble-tags/polling-mode.ts` — função pura que decide IDLE/TURBO
- `backend/src/modules/ble-tags/polling-mode.spec.ts`
- `backend/src/modules/ble-tags/ble-tags.service.spec.ts`

**Worker (criar):**
- `ktag-findmy-worker/findmy_worker/report_mapper.py` — relatório da Apple → payload do backend
- `ktag-findmy-worker/findmy_worker/dedupe.py` — memória de relatórios já enviados
- `ktag-findmy-worker/findmy_worker/silence.py` — detector de silêncio suspeito
- `ktag-findmy-worker/findmy_worker/outbox.py` — fila local quando o backend está fora
- `ktag-findmy-worker/findmy_worker/backend_client.py` — fala com o 21 GO
- `ktag-findmy-worker/findmy_worker/apple_client.py` — fala com a Apple via FindMy.py
- `ktag-findmy-worker/findmy_worker/loop.py` — o ciclo
- `ktag-findmy-worker/tests/` — pytest de cada módulo puro
- `ktag-findmy-worker/{requirements.txt,Dockerfile,.env.example,.gitignore,README.md}`

**Frontend (modificar):**
- `frontend/dashboard/src/types/ble-tag.ts`
- `frontend/dashboard/src/app/(dashboard)/etiquetas-ble/page.tsx`

O frontend do projeto **não tem suíte de testes** (só `next lint`). As tasks de UI são verificadas por lint + build, não por teste automatizado.

---

### Task 1: Colunas novas e gravação com `seenAt`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260820120000_ktag_findmy/migration.sql`
- Modify: `backend/src/modules/ble-tags/dto/create-sighting.dto.ts`
- Modify: `backend/src/modules/ble-tags/ble-tags.service.ts`
- Create: `backend/src/modules/ble-tags/ble-tags.service.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: campos `Device.bleAdvKeyPrivate`, `Device.bleAdvKeyHashed`, `Device.bleTurboUntil`; campos `BleSighting.seenAt` (não-nulo) e `BleSighting.accuracy` (nulo); `CreateSightingDto` com `rssi?`, `seenAt?`, `accuracy?`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/src/modules/ble-tags/ble-tags.service.spec.ts`:

```typescript
import { BleTagsService } from './ble-tags.service';

describe('BleTagsService.createSighting', () => {
  const device = {
    id: 'dev-1',
    imei: '92603008494',
    model: 'BLE_KTAG',
    vehicleId: 'veh-1',
  };

  function montarService() {
    const sightingCriado: any[] = [];
    const deviceAtualizado: any[] = [];
    const prisma: any = {
      device: {
        findFirst: jest.fn().mockResolvedValue(device),
        update: jest.fn((args) => {
          deviceAtualizado.push(args);
          return Promise.resolve(device);
        }),
      },
      bleSighting: {
        create: jest.fn((args) => {
          sightingCriado.push(args);
          return Promise.resolve({ id: 'sig-1', ...args.data });
        }),
      },
    };
    return {
      service: new BleTagsService(prisma),
      sightingCriado,
      deviceAtualizado,
    };
  }

  it('aceita relatorio da rede Apple, que nao tem rssi', async () => {
    const { service, sightingCriado } = montarService();
    const visto = new Date('2026-08-20T10:00:00.000Z');

    await service.createSighting(
      {
        deviceImei: '92603008494',
        macAddress: 'EB:25:02:3C:02:0E',
        seenAt: visto.toISOString(),
        accuracy: 40,
        scannerLat: -22.9,
        scannerLng: -43.2,
        scannerSource: 'apple-findmy',
      } as any,
      'tenant-1',
    );

    expect(sightingCriado[0].data.rssi).toBeNull();
    expect(sightingCriado[0].data.accuracy).toBe(40);
    expect(sightingCriado[0].data.seenAt).toEqual(visto);
  });

  it('usa o momento atual como seenAt quando o scanner local nao informa', async () => {
    const { service, sightingCriado } = montarService();
    const antes = Date.now();

    await service.createSighting(
      {
        deviceImei: '92603008494',
        macAddress: 'EB:25:02:3C:02:0E',
        rssi: -55,
        scannerSource: 'ble-local',
      } as any,
      'tenant-1',
    );

    const gravado = sightingCriado[0].data.seenAt.getTime();
    expect(gravado).toBeGreaterThanOrEqual(antes);
    expect(sightingCriado[0].data.rssi).toBe(-55);
  });

  it('marca lastConnection com o momento em que a TAG foi vista, nao com o de gravacao', async () => {
    const { service, deviceAtualizado } = montarService();
    const visto = new Date('2026-08-20T08:00:00.000Z');

    await service.createSighting(
      {
        deviceImei: '92603008494',
        macAddress: 'EB:25:02:3C:02:0E',
        seenAt: visto.toISOString(),
        scannerSource: 'apple-findmy',
      } as any,
      'tenant-1',
    );

    expect(deviceAtualizado[0].data.lastConnection).toEqual(visto);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest src/modules/ble-tags/ble-tags.service.spec.ts`
Expected: FAIL — o service ainda ignora `seenAt` e `accuracy`, e `lastConnection` recebe `sighting.createdAt`.

- [ ] **Step 3: Adicionar os campos no schema**

Em `backend/prisma/schema.prisma`, dentro de `model Device`, logo abaixo de `lastConnection`:

```prisma
  /// Chave privada da etiqueta BLE (base64). Segredo operacional: permite
  /// decifrar a posição da TAG na rede Find My. Nunca sai em listagem.
  bleAdvKeyPrivate String?   @map("ble_adv_key_private")
  /// SHA-256 da advertisement key (base64), usado para casar o relatório.
  bleAdvKeyHashed  String?   @map("ble_adv_key_hashed")
  /// Enquanto estiver no futuro, a TAG é consultada em ritmo acelerado.
  bleTurboUntil    DateTime? @map("ble_turbo_until")
```

Em `model BleSighting`, trocar a linha `rssi Int` por, e acrescentar:

```prisma
  /// Nulo em relatório da rede Apple: a posição vem do iPhone que ouviu, não
  /// da potência do sinal.
  rssi          Int?
  /// Raio de confiança em metros informado pela rede Find My.
  accuracy      Int?
  /// Momento em que a TAG foi vista. É o carimbo que vale para decidir onde o
  /// veículo está — `createdAt` é apenas quando gravamos.
  seenAt        DateTime @default(now()) @map("seen_at")
```

E acrescentar o índice, junto dos que já existem:

```prisma
  @@index([deviceId, seenAt(sort: Desc)])
```

- [ ] **Step 4: Escrever a migration**

Criar `backend/prisma/migrations/20260820120000_ktag_findmy/migration.sql`:

```sql
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ble_adv_key_private" TEXT;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ble_adv_key_hashed" TEXT;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "ble_turbo_until" TIMESTAMP(3);

ALTER TABLE "ble_sightings" ALTER COLUMN "rssi" DROP NOT NULL;
ALTER TABLE "ble_sightings" ADD COLUMN IF NOT EXISTS "accuracy" INTEGER;
ALTER TABLE "ble_sightings" ADD COLUMN IF NOT EXISTS "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "ble_sightings_device_id_seen_at_idx"
  ON "ble_sightings"("device_id", "seen_at" DESC);
```

- [ ] **Step 5: Regenerar o Prisma Client**

Run: `cd backend && npx prisma generate`
Expected: `Generated Prisma Client`.

- [ ] **Step 6: Atualizar o DTO**

Em `backend/src/modules/ble-tags/dto/create-sighting.dto.ts`, trocar o bloco do `rssi` e acrescentar os dois campos novos. O import de `class-validator` passa a incluir `IsISO8601`:

```typescript
  @ApiPropertyOptional({
    example: -55,
    description:
      'RSSI em dBm. Ausente em relatório da rede Apple, que não expõe potência de sinal.',
  })
  @IsOptional()
  @IsInt()
  @Min(-127)
  @Max(20)
  rssi?: number;

  @ApiPropertyOptional({
    example: '2026-08-20T10:00:00.000Z',
    description:
      'Momento em que a TAG foi vista. Ausente no scanner local, que reporta na hora.',
  })
  @IsOptional()
  @IsISO8601()
  seenAt?: string;

  @ApiPropertyOptional({
    example: 40,
    description: 'Raio de confiança em metros informado pela rede Find My.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  accuracy?: number;
```

- [ ] **Step 7: Gravar os campos no service**

Em `backend/src/modules/ble-tags/ble-tags.service.ts`, dentro de `createSighting`, substituir a criação do sighting e o update do device:

```typescript
    const seenAt = dto.seenAt ? new Date(dto.seenAt) : new Date();

    const sighting = await this.sightingModel.create({
      data: {
        deviceId: device.id,
        macAddress: dto.macAddress,
        rssi: dto.rssi ?? null,
        accuracy: dto.accuracy ?? null,
        seenAt,
        hashedAdvKey: dto.hashedAdvKey,
        counterByte: dto.counterByte,
        scannerLat: dto.scannerLat,
        scannerLng: dto.scannerLng,
        scannerSource: dto.scannerSource,
        tenantId,
      },
    });

    await this.deviceModel.update({
      where: { id: device.id },
      data: { lastConnection: seenAt },
    });
```

No payload emitido por `this.emitter`, trocar `createdAt: sighting.createdAt` por:

```typescript
        seenAt: sighting.seenAt,
        accuracy: sighting.accuracy,
        createdAt: sighting.createdAt,
```

E acrescentar `seenAt: Date;` e `accuracy: number | null;` ao tipo `SightingEmittedPayload['sighting']`, mantendo `rssi` como `number | null`.

Em `findAll`, o `select` do `bleSightings` passa a incluir `seenAt: true` e `accuracy: true`.

- [ ] **Step 8: Rodar os testes**

Run: `cd backend && npx jest src/modules/ble-tags/ble-tags.service.spec.ts`
Expected: PASS, 3/3.

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/modules/ble-tags
git commit -m "feat(ktag): grava quando a TAG foi vista, nao so quando gravamos"
```

---

### Task 2: Decisão de ritmo (função pura)

**Files:**
- Create: `backend/src/modules/ble-tags/polling-mode.ts`
- Create: `backend/src/modules/ble-tags/polling-mode.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export const ALERTAS_QUE_ACELERAM: AlertType[]`
  - `export const INTERVALO_IDLE_S = 3600`, `export const INTERVALO_TURBO_S = 60`, `export const BACKFILL_TURBO_H = 168`, `export const TURBO_MANUAL_H = 6`
  - `export type ModoPolling = 'IDLE' | 'TURBO'`
  - `export function decidirModo(entrada: { alertasAbertos: string[]; turboUntil: Date | null; agora: Date }): { modo: ModoPolling; intervalSeconds: number; backfillHours: number }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/src/modules/ble-tags/polling-mode.spec.ts`:

```typescript
import {
  decidirModo,
  INTERVALO_IDLE_S,
  INTERVALO_TURBO_S,
  BACKFILL_TURBO_H,
} from './polling-mode';

const AGORA = new Date('2026-08-20T12:00:00.000Z');

describe('decidirModo', () => {
  it('fica em IDLE quando nada aconteceu', () => {
    const r = decidirModo({ alertasAbertos: [], turboUntil: null, agora: AGORA });
    expect(r.modo).toBe('IDLE');
    expect(r.intervalSeconds).toBe(INTERVALO_IDLE_S);
    expect(r.backfillHours).toBe(0);
  });

  it.each(['OFFLINE', 'GPS_SILENT', 'JAMMING', 'POWER_CUT'])(
    'acelera quando o rastreador do veiculo esta com alerta %s',
    (alerta) => {
      const r = decidirModo({
        alertasAbertos: [alerta],
        turboUntil: null,
        agora: AGORA,
      });
      expect(r.modo).toBe('TURBO');
      expect(r.intervalSeconds).toBe(INTERVALO_TURBO_S);
      expect(r.backfillHours).toBe(BACKFILL_TURBO_H);
    },
  );

  it('nao acelera por alerta que nao indica rastreador neutralizado', () => {
    const r = decidirModo({
      alertasAbertos: ['SPEED', 'IGNITION_ON', 'MAINTENANCE_DUE'],
      turboUntil: null,
      agora: AGORA,
    });
    expect(r.modo).toBe('IDLE');
  });

  it('acelera por acionamento manual ainda valido', () => {
    const r = decidirModo({
      alertasAbertos: [],
      turboUntil: new Date('2026-08-20T12:00:01.000Z'),
      agora: AGORA,
    });
    expect(r.modo).toBe('TURBO');
  });

  it('volta a IDLE quando o acionamento manual expirou', () => {
    const r = decidirModo({
      alertasAbertos: [],
      turboUntil: new Date('2026-08-20T11:59:59.000Z'),
      agora: AGORA,
    });
    expect(r.modo).toBe('IDLE');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest src/modules/ble-tags/polling-mode.spec.ts`
Expected: FAIL — `Cannot find module './polling-mode'`.

- [ ] **Step 3: Implementar**

Criar `backend/src/modules/ble-tags/polling-mode.ts`:

```typescript
/**
 * Decide com que pressa cada TAG é consultada na rede Find My.
 *
 * A TAG existe para o cenário em que o rastreador principal foi neutralizado:
 * bloqueador de sinal não desliga o Bluetooth dela. Por isso o gatilho do
 * ritmo acelerado são justamente os alertas de rastreador mudo.
 */

/** Alertas que indicam rastreador principal neutralizado ou mudo. */
export const ALERTAS_QUE_ACELERAM = [
  'OFFLINE',
  'GPS_SILENT',
  'JAMMING',
  'POWER_CUT',
];

export const INTERVALO_IDLE_S = 3600;
export const INTERVALO_TURBO_S = 60;

/**
 * A Apple guarda 7 dias de relatórios. Ao entrar em TURBO puxamos a janela
 * inteira de uma vez — é por isso que não precisamos consultar o tempo todo
 * só para ter histórico.
 */
export const BACKFILL_TURBO_H = 168;

/** Duração do acionamento manual feito pelo operador. */
export const TURBO_MANUAL_H = 6;

export type ModoPolling = 'IDLE' | 'TURBO';

export interface EntradaModo {
  alertasAbertos: string[];
  turboUntil: Date | null;
  agora: Date;
}

export interface ResultadoModo {
  modo: ModoPolling;
  intervalSeconds: number;
  backfillHours: number;
}

export function decidirModo(entrada: EntradaModo): ResultadoModo {
  const porAlerta = entrada.alertasAbertos.some((a) =>
    ALERTAS_QUE_ACELERAM.includes(a),
  );
  const porOperador =
    entrada.turboUntil !== null && entrada.turboUntil > entrada.agora;

  if (porAlerta || porOperador) {
    return {
      modo: 'TURBO',
      intervalSeconds: INTERVALO_TURBO_S,
      backfillHours: BACKFILL_TURBO_H,
    };
  }

  return {
    modo: 'IDLE',
    intervalSeconds: INTERVALO_IDLE_S,
    backfillHours: 0,
  };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `cd backend && npx jest src/modules/ble-tags/polling-mode.spec.ts`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ble-tags/polling-mode.ts backend/src/modules/ble-tags/polling-mode.spec.ts
git commit -m "feat(ktag): regra de ritmo acelerado quando o rastreador cala"
```

---

### Task 3: Rota do plano de polling

**Files:**
- Modify: `backend/src/modules/ble-tags/ble-tags.service.ts`
- Modify: `backend/src/modules/ble-tags/ble-tags.controller.ts`
- Modify: `backend/src/modules/ble-tags/ble-tags.service.spec.ts`

**Interfaces:**
- Consumes: `decidirModo`, `INTERVALO_IDLE_S`, `INTERVALO_TURBO_S`, `BACKFILL_TURBO_H` da Task 2; colunas da Task 1.
- Produces: `BleTagsService.getPollingPlan(tenantId: string): Promise<{ tags: PlanoTag[] }>` onde
  `PlanoTag = { deviceImei: string; privateKey: string; hashedAdvKey: string; mode: 'IDLE'|'TURBO'; intervalSeconds: number; backfillHours: number }`;
  rota `GET /ble-tags/polling-plan`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao final de `backend/src/modules/ble-tags/ble-tags.service.spec.ts`:

```typescript
describe('BleTagsService.getPollingPlan', () => {
  const AGORA = new Date('2026-08-20T12:00:00.000Z');

  function montarService(devices: any[], alertas: any[] = []) {
    const chamadas: any = {};
    const prisma: any = {
      device: {
        findMany: jest.fn((args) => {
          chamadas.device = args;
          return Promise.resolve(devices);
        }),
      },
      alert: {
        findMany: jest.fn((args) => {
          chamadas.alert = args;
          return Promise.resolve(alertas);
        }),
      },
    };
    return { service: new BleTagsService(prisma), chamadas };
  }

  const tagComChave = {
    imei: '92603008494',
    vehicleId: 'veh-1',
    bleAdvKeyPrivate: 'priv',
    bleAdvKeyHashed: 'hash',
    bleTurboUntil: null,
  };

  it('devolve a TAG em IDLE quando o veiculo nao tem alerta de rastreador mudo', async () => {
    const { service } = montarService([tagComChave]);
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags).toHaveLength(1);
    expect(plano.tags[0].mode).toBe('IDLE');
    expect(plano.tags[0].privateKey).toBe('priv');
  });

  it('acelera a TAG do veiculo cujo rastreador esta sob jamming', async () => {
    const { service } = montarService(
      [tagComChave],
      [{ vehicleId: 'veh-1', type: 'JAMMING' }],
    );
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags[0].mode).toBe('TURBO');
    expect(plano.tags[0].backfillHours).toBe(168);
  });

  it('nao acelera uma TAG por causa de alerta de outro veiculo', async () => {
    const { service } = montarService(
      [tagComChave],
      [{ vehicleId: 'veh-OUTRO', type: 'JAMMING' }],
    );
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags[0].mode).toBe('IDLE');
  });

  it('ignora TAG sem chave cadastrada, que o worker nao teria como consultar', async () => {
    const { service } = montarService([
      { ...tagComChave, bleAdvKeyPrivate: null },
    ]);
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags).toHaveLength(0);
  });

  it('filtra por tenant e por soft delete nas duas consultas', async () => {
    const { service, chamadas } = montarService([tagComChave]);
    await service.getPollingPlan('tenant-1', AGORA);

    expect(chamadas.device.where.tenantId).toBe('tenant-1');
    expect(chamadas.device.where.deletedAt).toBeNull();
    expect(chamadas.alert.where.tenantId).toBe('tenant-1');
  });

  it('nao devolve tenantId no corpo, para nao existir caminho de escrita cruzada', async () => {
    const { service } = montarService([tagComChave]);
    const plano = await service.getPollingPlan('tenant-1', AGORA);

    expect(plano.tags[0]).not.toHaveProperty('tenantId');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest src/modules/ble-tags/ble-tags.service.spec.ts`
Expected: FAIL — `service.getPollingPlan is not a function`.

- [ ] **Step 3: Implementar no service**

Em `backend/src/modules/ble-tags/ble-tags.service.ts`, acrescentar o import e o método. O import fica junto dos demais:

```typescript
import { decidirModo, ModoPolling } from './polling-mode';
```

Acrescentar o getter do model de alerta, junto dos outros getters:

```typescript
  private get alertModel() {
    return (this.prisma as any).alert;
  }
```

E o método, ao final da classe:

```typescript
  /**
   * O que o worker deve buscar e com que pressa. Toda a regra de ritmo mora
   * aqui: o worker não conhece alerta nem veículo, só obedece o intervalo.
   *
   * `agora` é injetável para o teste não depender do relógio da máquina.
   */
  async getPollingPlan(tenantId: string, agora: Date = new Date()) {
    const tags = await this.deviceModel.findMany({
      where: {
        tenantId,
        deletedAt: null,
        model: { in: BLE_DEVICE_MODELS },
      },
      select: {
        imei: true,
        vehicleId: true,
        bleAdvKeyPrivate: true,
        bleAdvKeyHashed: true,
        bleTurboUntil: true,
      },
    });

    const comChave = tags.filter(
      (t: any) => t.bleAdvKeyPrivate && t.bleAdvKeyHashed,
    );
    if (comChave.length === 0) return { tags: [] };

    const alertas = await this.alertModel.findMany({
      where: {
        tenantId,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        vehicleId: {
          in: comChave.map((t: any) => t.vehicleId).filter(Boolean),
        },
      },
      select: { vehicleId: true, type: true },
    });

    const porVeiculo = new Map<string, string[]>();
    for (const a of alertas) {
      const lista = porVeiculo.get(a.vehicleId) ?? [];
      lista.push(a.type);
      porVeiculo.set(a.vehicleId, lista);
    }

    return {
      tags: comChave.map((t: any) => {
        const decisao = decidirModo({
          alertasAbertos: t.vehicleId
            ? (porVeiculo.get(t.vehicleId) ?? [])
            : [],
          turboUntil: t.bleTurboUntil,
          agora,
        });
        return {
          deviceImei: t.imei,
          privateKey: t.bleAdvKeyPrivate,
          hashedAdvKey: t.bleAdvKeyHashed,
          mode: decisao.modo as ModoPolling,
          intervalSeconds: decisao.intervalSeconds,
          backfillHours: decisao.backfillHours,
        };
      }),
    };
  }
```

- [ ] **Step 4: Expor a rota**

Em `backend/src/modules/ble-tags/ble-tags.controller.ts`, acrescentar a rota **antes** de `@Get(':id')` — senão o Nest casa `polling-plan` como se fosse um id:

```typescript
  @Get('polling-plan')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Plano de consulta da rede Find My (uso exclusivo do worker; devolve chave privada)',
  })
  async pollingPlan(@Req() req: AuthenticatedRequest) {
    return this.bleTagsService.getPollingPlan(req.tenantId);
  }
```

- [ ] **Step 5: Rodar os testes**

Run: `cd backend && npx jest src/modules/ble-tags`
Expected: PASS — 3 de `createSighting`, 8 de `polling-mode`, 6 de `getPollingPlan`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ble-tags
git commit -m "feat(ktag): rota que diz ao worker o que buscar e com que pressa"
```

---

### Task 4: Acionamento manual do ritmo acelerado

**Files:**
- Modify: `backend/src/modules/ble-tags/ble-tags.service.ts`
- Modify: `backend/src/modules/ble-tags/ble-tags.controller.ts`
- Modify: `backend/src/modules/ble-tags/ble-tags.service.spec.ts`

**Interfaces:**
- Consumes: `TURBO_MANUAL_H` da Task 2; `findOne` já existente no service.
- Produces: `BleTagsService.acionarTurbo(id: string, tenantId: string, agora?: Date): Promise<{ bleTurboUntil: Date }>`; rota `POST /ble-tags/:id/turbo`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao final de `backend/src/modules/ble-tags/ble-tags.service.spec.ts`:

```typescript
describe('BleTagsService.acionarTurbo', () => {
  const AGORA = new Date('2026-08-20T12:00:00.000Z');

  it('liga o ritmo acelerado por 6 horas a partir de agora', async () => {
    const atualizacoes: any[] = [];
    const prisma: any = {
      device: {
        findFirst: jest.fn().mockResolvedValue({ id: 'dev-1', model: 'BLE_KTAG' }),
        update: jest.fn((args) => {
          atualizacoes.push(args);
          return Promise.resolve({ ...args.data });
        }),
      },
    };
    const service = new BleTagsService(prisma);

    const r = await service.acionarTurbo('dev-1', 'tenant-1', AGORA);

    expect(r.bleTurboUntil).toEqual(new Date('2026-08-20T18:00:00.000Z'));
    expect(atualizacoes[0].where.id).toBe('dev-1');
  });

  it('recusa TAG de outro tenant', async () => {
    const prisma: any = {
      device: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const service = new BleTagsService(prisma);

    await expect(
      service.acionarTurbo('dev-1', 'tenant-INTRUSO', AGORA),
    ).rejects.toThrow('TAG BLE não encontrada');
    expect(prisma.device.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest src/modules/ble-tags/ble-tags.service.spec.ts`
Expected: FAIL — `service.acionarTurbo is not a function`.

- [ ] **Step 3: Implementar no service**

Acrescentar `TURBO_MANUAL_H` ao import de `./polling-mode` e o método ao final da classe:

```typescript
  /**
   * Liga o ritmo acelerado por decisão do operador — para o caso em que a
   * suspeita chega por telefone antes de qualquer alerta automático.
   */
  async acionarTurbo(id: string, tenantId: string, agora: Date = new Date()) {
    await this.findOne(id, tenantId);

    const bleTurboUntil = new Date(
      agora.getTime() + TURBO_MANUAL_H * 60 * 60 * 1000,
    );

    await this.deviceModel.update({
      where: { id },
      data: { bleTurboUntil },
    });

    this.logger.log(
      `Ritmo acelerado ligado na TAG ${id} até ${bleTurboUntil.toISOString()}`,
    );

    return { bleTurboUntil };
  }
```

- [ ] **Step 4: Expor a rota**

Em `backend/src/modules/ble-tags/ble-tags.controller.ts`, acrescentar ao final da classe:

```typescript
  @Post(':id/turbo')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR)
  @ApiOperation({
    summary: 'Liga o ritmo acelerado de consulta da TAG por 6 horas',
  })
  async acionarTurbo(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bleTagsService.acionarTurbo(id, req.tenantId);
  }
```

- [ ] **Step 5: Rodar os testes**

Run: `cd backend && npx jest src/modules/ble-tags`
Expected: PASS, 19/19.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ble-tags
git commit -m "feat(ktag): operador pode ligar o ritmo acelerado na mao"
```

---

### Task 5: Núcleo do worker — tradução e deduplicação

**Files:**
- Create: `ktag-findmy-worker/findmy_worker/__init__.py`
- Create: `ktag-findmy-worker/findmy_worker/report_mapper.py`
- Create: `ktag-findmy-worker/findmy_worker/dedupe.py`
- Create: `ktag-findmy-worker/tests/test_report_mapper.py`
- Create: `ktag-findmy-worker/tests/test_dedupe.py`
- Create: `ktag-findmy-worker/requirements.txt`
- Create: `ktag-findmy-worker/.gitignore`

**Interfaces:**
- Consumes: formato do `CreateSightingDto` da Task 1.
- Produces:
  - `report_mapper.relatorio_para_payload(relatorio: dict, device_imei: str) -> dict`
  - `dedupe.Dedupe(limite: int = 5000)` com `.ja_enviado(payload) -> bool` e `.marcar(payload) -> None`

- [ ] **Step 1: Escrever os testes que falham**

Criar `ktag-findmy-worker/tests/test_report_mapper.py`:

```python
from datetime import datetime, timezone

from findmy_worker.report_mapper import relatorio_para_payload


def test_traduz_relatorio_da_apple_para_o_formato_do_backend():
    relatorio = {
        "latitude": -22.9068,
        "longitude": -43.1729,
        "horizontal_accuracy": 40,
        "timestamp": datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc),
        "hashed_adv_key": "ub1FoLtdoAnRgH1/u9qjYETb5SNN1pJ/gXdWR1QNsUY=",
    }

    payload = relatorio_para_payload(relatorio, "92603008494")

    assert payload["deviceImei"] == "92603008494"
    assert payload["scannerLat"] == -22.9068
    assert payload["scannerLng"] == -43.1729
    assert payload["accuracy"] == 40
    assert payload["seenAt"] == "2026-08-20T10:00:00+00:00"
    assert payload["scannerSource"] == "apple-findmy"
    assert "rssi" not in payload


def test_relatorio_sem_precisao_nao_inventa_numero():
    relatorio = {
        "latitude": -22.9,
        "longitude": -43.1,
        "horizontal_accuracy": None,
        "timestamp": datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc),
        "hashed_adv_key": "abc",
    }

    payload = relatorio_para_payload(relatorio, "92603008494")

    assert "accuracy" not in payload


def test_timestamp_sem_fuso_e_tratado_como_utc():
    relatorio = {
        "latitude": -22.9,
        "longitude": -43.1,
        "horizontal_accuracy": 10,
        "timestamp": datetime(2026, 8, 20, 10, 0),
        "hashed_adv_key": "abc",
    }

    payload = relatorio_para_payload(relatorio, "92603008494")

    assert payload["seenAt"].endswith("+00:00")
```

Criar `ktag-findmy-worker/tests/test_dedupe.py`:

```python
from findmy_worker.dedupe import Dedupe


def payload(seen_at="2026-08-20T10:00:00+00:00", chave="abc"):
    return {
        "deviceImei": "92603008494",
        "hashedAdvKey": chave,
        "seenAt": seen_at,
        "scannerLat": -22.9,
        "scannerLng": -43.1,
    }


def test_o_mesmo_relatorio_nao_e_enviado_duas_vezes():
    d = Dedupe()
    p = payload()

    assert d.ja_enviado(p) is False
    d.marcar(p)
    assert d.ja_enviado(p) is True


def test_relatorio_de_outro_instante_passa():
    d = Dedupe()
    d.marcar(payload())

    assert d.ja_enviado(payload(seen_at="2026-08-20T10:05:00+00:00")) is False


def test_relatorio_de_outra_tag_no_mesmo_instante_passa():
    d = Dedupe()
    d.marcar(payload())

    assert d.ja_enviado(payload(chave="xyz")) is False


def test_memoria_nao_cresce_sem_limite():
    d = Dedupe(limite=10)
    for i in range(50):
        d.marcar(payload(seen_at=f"2026-08-20T10:{i:02d}:00+00:00"))

    assert len(d) <= 10
    assert d.ja_enviado(payload(seen_at="2026-08-20T10:49:00+00:00")) is True
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ktag-findmy-worker && python -m pytest -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'findmy_worker'`.

- [ ] **Step 3: Criar o pacote e as dependências**

Criar `ktag-findmy-worker/findmy_worker/__init__.py` vazio.

Criar `ktag-findmy-worker/requirements.txt`:

```
findmy==0.10.1
httpx==0.27.2
python-dotenv==1.0.1
pytest==8.3.3
```

Criar `ktag-findmy-worker/.gitignore`:

```
.env
__pycache__/
.pytest_cache/
outbox/
sessao-apple/
```

- [ ] **Step 4: Implementar o tradutor**

Criar `ktag-findmy-worker/findmy_worker/report_mapper.py`:

```python
"""
Traduz um relatório da rede Find My para o payload que o backend 21 GO aceita.

A rede Apple não informa RSSI: a posição vem do iPhone que ouviu a TAG, não da
potência do sinal. Por isso o campo simplesmente não vai no payload — inventar
um número aqui viraria dado falso na tela do operador.
"""
from datetime import timezone


def relatorio_para_payload(relatorio: dict, device_imei: str) -> dict:
    visto_em = relatorio["timestamp"]
    if visto_em.tzinfo is None:
        visto_em = visto_em.replace(tzinfo=timezone.utc)

    payload = {
        "deviceImei": device_imei,
        "macAddress": "",
        "hashedAdvKey": relatorio["hashed_adv_key"],
        "seenAt": visto_em.isoformat(),
        "scannerLat": relatorio["latitude"],
        "scannerLng": relatorio["longitude"],
        "scannerSource": "apple-findmy",
    }

    precisao = relatorio.get("horizontal_accuracy")
    if precisao is not None:
        payload["accuracy"] = int(precisao)

    return payload
```

- [ ] **Step 5: Implementar a deduplicação**

Criar `ktag-findmy-worker/findmy_worker/dedupe.py`:

```python
"""
Memória curta do que já foi entregue ao backend.

A Apple devolve a mesma janela de relatórios a cada consulta, então sem isso
cada ciclo reenviaria tudo de novo. A identidade de um relatório é a TAG mais o
instante em que ela foi vista.
"""
from collections import OrderedDict


class Dedupe:
    def __init__(self, limite: int = 5000):
        self._limite = limite
        self._vistos: OrderedDict = OrderedDict()

    def _chave(self, payload: dict) -> str:
        return f"{payload['hashedAdvKey']}|{payload['seenAt']}"

    def ja_enviado(self, payload: dict) -> bool:
        return self._chave(payload) in self._vistos

    def marcar(self, payload: dict) -> None:
        chave = self._chave(payload)
        self._vistos[chave] = True
        self._vistos.move_to_end(chave)
        while len(self._vistos) > self._limite:
            self._vistos.popitem(last=False)

    def __len__(self) -> int:
        return len(self._vistos)
```

- [ ] **Step 6: Rodar os testes**

Run: `cd ktag-findmy-worker && python -m pytest -q`
Expected: PASS, 7/7.

- [ ] **Step 7: Commit**

```bash
git add ktag-findmy-worker
git commit -m "feat(ktag): traducao e deduplicacao dos relatorios da rede Find My"
```

---

### Task 6: Fila local e detector de silêncio

**Files:**
- Create: `ktag-findmy-worker/findmy_worker/outbox.py`
- Create: `ktag-findmy-worker/findmy_worker/silence.py`
- Create: `ktag-findmy-worker/tests/test_outbox.py`
- Create: `ktag-findmy-worker/tests/test_silence.py`

**Interfaces:**
- Consumes: formato de payload da Task 5.
- Produces:
  - `outbox.Outbox(pasta: Path)` com `.guardar(payload)`, `.pendentes() -> list[tuple[Path, dict]]`, `.remover(caminho)`
  - `silence.DetectorDeSilencio(janela_horas: float = 6.0)` com `.registrar_ciclo(houve_relatorio: bool, agora: datetime) -> bool`

- [ ] **Step 1: Escrever os testes que falham**

Criar `ktag-findmy-worker/tests/test_outbox.py`:

```python
from findmy_worker.outbox import Outbox


def test_payload_guardado_volta_igual(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1", "seenAt": "2026-08-20T10:00:00+00:00"})

    pendentes = caixa.pendentes()

    assert len(pendentes) == 1
    assert pendentes[0][1]["deviceImei"] == "1"


def test_sobrevive_a_reinicio_do_processo(tmp_path):
    Outbox(tmp_path).guardar({"deviceImei": "1"})

    assert len(Outbox(tmp_path).pendentes()) == 1


def test_removido_nao_volta(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1"})
    caminho, _ = caixa.pendentes()[0]

    caixa.remover(caminho)

    assert caixa.pendentes() == []


def test_dois_payloads_no_mesmo_instante_nao_se_sobrescrevem(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "1"})
    caixa.guardar({"deviceImei": "2"})

    assert len(caixa.pendentes()) == 2
```

Criar `ktag-findmy-worker/tests/test_silence.py`:

```python
from datetime import datetime, timedelta, timezone

from findmy_worker.silence import DetectorDeSilencio

INICIO = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)


def test_nao_alarma_enquanto_a_janela_nao_fecha():
    d = DetectorDeSilencio(janela_horas=6)

    assert d.registrar_ciclo(False, INICIO) is False
    assert d.registrar_ciclo(False, INICIO + timedelta(hours=5)) is False


def test_alarma_depois_de_seis_horas_sem_nenhum_relatorio():
    d = DetectorDeSilencio(janela_horas=6)
    d.registrar_ciclo(False, INICIO)

    assert d.registrar_ciclo(False, INICIO + timedelta(hours=6, minutes=1)) is True


def test_um_relatorio_de_qualquer_tag_zera_a_contagem():
    d = DetectorDeSilencio(janela_horas=6)
    d.registrar_ciclo(False, INICIO)
    d.registrar_ciclo(True, INICIO + timedelta(hours=5))

    assert d.registrar_ciclo(False, INICIO + timedelta(hours=7)) is False


def test_nao_alarma_repetido_sem_novo_periodo_de_silencio():
    d = DetectorDeSilencio(janela_horas=6)
    d.registrar_ciclo(False, INICIO)
    assert d.registrar_ciclo(False, INICIO + timedelta(hours=7)) is True
    assert d.registrar_ciclo(False, INICIO + timedelta(hours=8)) is False
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ktag-findmy-worker && python -m pytest -q tests/test_outbox.py tests/test_silence.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'findmy_worker.outbox'`.

- [ ] **Step 3: Implementar a fila local**

Criar `ktag-findmy-worker/findmy_worker/outbox.py`:

```python
"""
Fila em disco para quando o backend do 21 GO está fora do ar.

Relatório da rede Find My tem validade: a Apple guarda 7 dias, mas o que já
baixamos e não entregamos se perde na memória do processo. Gravar em arquivo é
o que garante que uma indisponibilidade nossa não apague posição de veículo
roubado.
"""
import json
import uuid
from pathlib import Path


class Outbox:
    def __init__(self, pasta: Path):
        self._pasta = Path(pasta)
        self._pasta.mkdir(parents=True, exist_ok=True)

    def guardar(self, payload: dict) -> Path:
        caminho = self._pasta / f"{uuid.uuid4().hex}.json"
        caminho.write_text(json.dumps(payload), encoding="utf-8")
        return caminho

    def pendentes(self) -> list:
        itens = []
        for caminho in sorted(self._pasta.glob("*.json")):
            try:
                itens.append((caminho, json.loads(caminho.read_text(encoding="utf-8"))))
            except json.JSONDecodeError:
                caminho.unlink(missing_ok=True)
        return itens

    def remover(self, caminho: Path) -> None:
        Path(caminho).unlink(missing_ok=True)
```

- [ ] **Step 4: Implementar o detector de silêncio**

Criar `ktag-findmy-worker/findmy_worker/silence.py`:

```python
"""
Distingue "ninguém viu a TAG" de "a Apple nos bloqueou".

A Apple responde 200 OK com lista vazia nos dois casos. Confundir os dois é
ficar meses achando que a TAG está fora de área quando na verdade o IP do
proxy foi barrado. Se ao menos uma TAG reportou na janela, o silêncio das
outras é normal e nada é alarmado.
"""
from datetime import datetime, timedelta


class DetectorDeSilencio:
    def __init__(self, janela_horas: float = 6.0):
        self._janela = timedelta(hours=janela_horas)
        self._ultimo_relatorio: datetime | None = None
        self._ja_alarmou = False

    def registrar_ciclo(self, houve_relatorio: bool, agora: datetime) -> bool:
        if houve_relatorio:
            self._ultimo_relatorio = agora
            self._ja_alarmou = False
            return False

        if self._ultimo_relatorio is None:
            self._ultimo_relatorio = agora
            return False

        if self._ja_alarmou:
            return False

        if agora - self._ultimo_relatorio > self._janela:
            self._ja_alarmou = True
            return True

        return False
```

- [ ] **Step 5: Rodar os testes**

Run: `cd ktag-findmy-worker && python -m pytest -q`
Expected: PASS, 15/15.

- [ ] **Step 6: Commit**

```bash
git add ktag-findmy-worker
git commit -m "feat(ktag): fila local e deteccao de silencio suspeito"
```

---

### Task 7: Cliente do backend, cliente da Apple e o ciclo

**Files:**
- Create: `ktag-findmy-worker/findmy_worker/backend_client.py`
- Create: `ktag-findmy-worker/findmy_worker/apple_client.py`
- Create: `ktag-findmy-worker/findmy_worker/loop.py`
- Create: `ktag-findmy-worker/tests/test_loop.py`
- Create: `ktag-findmy-worker/Dockerfile`
- Create: `ktag-findmy-worker/.env.example`
- Create: `ktag-findmy-worker/README.md`

**Interfaces:**
- Consumes: `relatorio_para_payload`, `Dedupe`, `Outbox`, `DetectorDeSilencio`; rotas `GET /ble-tags/polling-plan` e `POST /ble-tags/sightings`.
- Produces: `loop.executar_ciclo(backend, apple, dedupe, outbox, detector, agora) -> dict` com as chaves `enviados`, `enfileirados`, `silencio_suspeito`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `ktag-findmy-worker/tests/test_loop.py`:

```python
from datetime import datetime, timezone

from findmy_worker.dedupe import Dedupe
from findmy_worker.loop import executar_ciclo
from findmy_worker.outbox import Outbox
from findmy_worker.silence import DetectorDeSilencio

AGORA = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)

PLANO = {
    "tags": [
        {
            "deviceImei": "92603008494",
            "privateKey": "priv",
            "hashedAdvKey": "hash",
            "mode": "TURBO",
            "intervalSeconds": 60,
            "backfillHours": 168,
        }
    ]
}


def um_relatorio(minuto=0):
    return {
        "latitude": -22.9,
        "longitude": -43.1,
        "horizontal_accuracy": 30,
        "timestamp": datetime(2026, 8, 20, 11, minuto, tzinfo=timezone.utc),
        "hashed_adv_key": "hash",
    }


class BackendFalso:
    def __init__(self, falha_ao_enviar=False):
        self.enviados = []
        self.falha_ao_enviar = falha_ao_enviar

    def plano(self):
        return PLANO

    def enviar(self, payload):
        if self.falha_ao_enviar:
            raise ConnectionError("backend fora")
        self.enviados.append(payload)


class AppleFalsa:
    def __init__(self, relatorios):
        self.relatorios = relatorios
        self.pedidos = []

    def buscar(self, tags, backfill_horas):
        self.pedidos.append((tags, backfill_horas))
        return self.relatorios


def test_relatorio_novo_chega_ao_backend(tmp_path):
    backend = BackendFalso()
    r = executar_ciclo(
        backend, AppleFalsa([um_relatorio()]), Dedupe(),
        Outbox(tmp_path), DetectorDeSilencio(), AGORA,
    )

    assert r["enviados"] == 1
    assert backend.enviados[0]["deviceImei"] == "92603008494"
    assert backend.enviados[0]["scannerSource"] == "apple-findmy"


def test_o_mesmo_relatorio_no_ciclo_seguinte_nao_e_reenviado(tmp_path):
    backend = BackendFalso()
    dedupe, caixa, det = Dedupe(), Outbox(tmp_path), DetectorDeSilencio()
    apple = AppleFalsa([um_relatorio()])

    executar_ciclo(backend, apple, dedupe, caixa, det, AGORA)
    r = executar_ciclo(backend, apple, dedupe, caixa, det, AGORA)

    assert r["enviados"] == 0
    assert len(backend.enviados) == 1


def test_backend_fora_do_ar_guarda_na_fila_em_vez_de_perder(tmp_path):
    caixa = Outbox(tmp_path)
    r = executar_ciclo(
        BackendFalso(falha_ao_enviar=True), AppleFalsa([um_relatorio()]),
        Dedupe(), caixa, DetectorDeSilencio(), AGORA,
    )

    assert r["enfileirados"] == 1
    assert len(caixa.pendentes()) == 1


def test_fila_e_drenada_quando_o_backend_volta(tmp_path):
    caixa = Outbox(tmp_path)
    caixa.guardar({"deviceImei": "92603008494", "seenAt": "x"})
    backend = BackendFalso()

    executar_ciclo(backend, AppleFalsa([]), Dedupe(), caixa, DetectorDeSilencio(), AGORA)

    assert len(backend.enviados) == 1
    assert caixa.pendentes() == []


def test_pede_o_historico_de_sete_dias_quando_a_tag_esta_em_turbo(tmp_path):
    apple = AppleFalsa([])
    executar_ciclo(
        BackendFalso(), apple, Dedupe(), Outbox(tmp_path),
        DetectorDeSilencio(), AGORA,
    )

    assert apple.pedidos[0][1] == 168


def test_ciclo_sem_relatorio_nenhum_avisa_o_detector(tmp_path):
    class DetectorEspiao(DetectorDeSilencio):
        def __init__(self):
            super().__init__()
            self.chamadas = []

        def registrar_ciclo(self, houve, agora):
            self.chamadas.append(houve)
            return False

    det = DetectorEspiao()
    executar_ciclo(BackendFalso(), AppleFalsa([]), Dedupe(), Outbox(tmp_path), det, AGORA)

    assert det.chamadas == [False]
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ktag-findmy-worker && python -m pytest -q tests/test_loop.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'findmy_worker.loop'`.

- [ ] **Step 3: Implementar o ciclo**

Criar `ktag-findmy-worker/findmy_worker/loop.py`:

```python
"""
O ciclo do worker.

Regra de fronteira: o backend decide, o worker obedece. Aqui não existe
nenhuma decisão sobre quais TAGs importam ou com que pressa — isso vem pronto
no plano. O ciclo só traduz, deduplica e entrega.
"""
from .report_mapper import relatorio_para_payload


def executar_ciclo(backend, apple, dedupe, outbox, detector, agora) -> dict:
    _drenar_fila(backend, outbox)

    plano = backend.plano()
    tags = plano.get("tags", [])
    if not tags:
        detector.registrar_ciclo(False, agora)
        return {"enviados": 0, "enfileirados": 0, "silencio_suspeito": False}

    backfill = max(t.get("backfillHours", 0) for t in tags)
    relatorios = apple.buscar(tags, backfill)

    por_chave = {t["hashedAdvKey"]: t["deviceImei"] for t in tags}

    enviados = 0
    enfileirados = 0
    for relatorio in relatorios:
        imei = por_chave.get(relatorio["hashed_adv_key"])
        if imei is None:
            continue

        payload = relatorio_para_payload(relatorio, imei)
        if dedupe.ja_enviado(payload):
            continue

        try:
            backend.enviar(payload)
            enviados += 1
        except Exception:
            outbox.guardar(payload)
            enfileirados += 1

        dedupe.marcar(payload)

    suspeito = detector.registrar_ciclo(bool(relatorios), agora)

    return {
        "enviados": enviados,
        "enfileirados": enfileirados,
        "silencio_suspeito": suspeito,
    }


def _drenar_fila(backend, outbox) -> None:
    for caminho, payload in outbox.pendentes():
        try:
            backend.enviar(payload)
            outbox.remover(caminho)
        except Exception:
            return
```

- [ ] **Step 4: Rodar os testes**

Run: `cd ktag-findmy-worker && python -m pytest -q`
Expected: PASS, 21/21.

- [ ] **Step 5: Implementar o cliente do backend**

Criar `ktag-findmy-worker/findmy_worker/backend_client.py`:

```python
"""
Fala com o backend do 21 GO.

O tráfego para o nosso backend NÃO passa pelo proxy residencial: o proxy
existe só para a Apple, que barra IP de datacenter.
"""
import httpx


class BackendClient:
    def __init__(self, base_url: str, token: str, timeout: float = 30.0):
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
            trust_env=False,
        )

    def plano(self) -> dict:
        resposta = self._http.get("/ble-tags/polling-plan")
        resposta.raise_for_status()
        return resposta.json()

    def enviar(self, payload: dict) -> None:
        resposta = self._http.post("/ble-tags/sightings", json=payload)
        resposta.raise_for_status()
```

`trust_env=False` é o que impede o `HTTPS_PROXY` do ambiente de sequestrar também as chamadas ao nosso backend.

- [ ] **Step 6: Implementar o cliente da Apple**

Criar `ktag-findmy-worker/findmy_worker/apple_client.py`:

```python
"""
Fala com a rede Find My via FindMy.py, saindo pelo proxy residencial.

A Apple bloqueia consulta de Find My vinda de datacenter — DigitalOcean
incluída. Sem proxy, o login retorna 200 OK e a busca devolve lista vazia, o
que é indistinguível de "ninguém viu a TAG". Por isso o worker se recusa a
consultar sem proxy configurado.
"""
from datetime import timedelta
from pathlib import Path

from findmy import KeyPair
from findmy.reports import RemoteAnisetteProvider, AppleAccount


class AppleClient:
    def __init__(self, pasta_sessao: Path, anisette_url: str, proxy: str):
        if not proxy:
            raise ValueError(
                "Proxy residencial não configurado. Consultar a Apple pelo IP "
                "do droplet devolve lista vazia silenciosamente."
            )
        self._pasta_sessao = Path(pasta_sessao)
        self._anisette = RemoteAnisetteProvider(anisette_url)
        self._proxy = proxy
        self._conta = None

    def _sessao(self) -> AppleAccount:
        if self._conta is None:
            arquivo = self._pasta_sessao / "account.json"
            if not arquivo.exists():
                raise RuntimeError(
                    "Sessão da Apple ausente. Rodar o login interativo uma vez "
                    "com --trusteddevice (o código chega no iPhone)."
                )
            conta = AppleAccount(self._anisette)
            conta.restore(arquivo.read_text(encoding="utf-8"))
            self._conta = conta
        return self._conta

    def buscar(self, tags: list, backfill_horas: int) -> list:
        conta = self._sessao()
        chaves = [KeyPair.from_b64(t["privateKey"]) for t in tags]
        janela = timedelta(hours=backfill_horas or 1)

        relatorios = conta.fetch_last_reports(chaves, hours=int(janela.total_seconds() // 3600))

        return [
            {
                "latitude": r.latitude,
                "longitude": r.longitude,
                "horizontal_accuracy": getattr(r, "horizontal_accuracy", None),
                "timestamp": r.timestamp,
                "hashed_adv_key": r.hashed_adv_key_b64,
            }
            for r in relatorios
        ]
```

- [ ] **Step 7: Escrever o entrypoint**

Criar `ktag-findmy-worker/findmy_worker/main.py`. É ele que o container executa:

```python
"""
Entrypoint do worker: monta as peças, roda o ciclo e dorme o que o backend mandou.

O intervalo não é decidido aqui — vem no plano. Se alguma TAG está em ritmo
acelerado, o ciclo inteiro roda no ritmo dela.
"""
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from .apple_client import AppleClient
from .backend_client import BackendClient
from .dedupe import Dedupe
from .loop import executar_ciclo
from .outbox import Outbox
from .silence import DetectorDeSilencio

INTERVALO_PADRAO_S = 3600
INTERVALO_APOS_ERRO_S = 300

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("ktag-worker")


def _intervalo_do_plano(backend) -> int:
    try:
        tags = backend.plano().get("tags", [])
    except Exception:
        return INTERVALO_PADRAO_S
    if not tags:
        return INTERVALO_PADRAO_S
    return min(t.get("intervalSeconds", INTERVALO_PADRAO_S) for t in tags)


def main() -> None:
    load_dotenv()

    backend = BackendClient(os.environ["BACKEND_URL"], os.environ["BACKEND_TOKEN"])
    apple = AppleClient(
        pasta_sessao=Path(os.environ["APPLE_SESSION_DIR"]),
        anisette_url=os.environ["ANISETTE_URL"],
        proxy=os.environ.get("APPLE_PROXY", ""),
    )
    outbox = Outbox(Path(os.environ["OUTBOX_DIR"]))
    dedupe = Dedupe()
    detector = DetectorDeSilencio()

    log.info("worker da K-Tag iniciado")

    while True:
        try:
            resultado = executar_ciclo(
                backend, apple, dedupe, outbox, detector,
                datetime.now(timezone.utc),
            )
            log.info(
                "ciclo: %s enviados, %s enfileirados",
                resultado["enviados"],
                resultado["enfileirados"],
            )
            if resultado["silencio_suspeito"]:
                log.error(
                    "SILENCIO SUSPEITO: nenhuma TAG reportou na janela. "
                    "Provavel bloqueio do IP do proxy pela Apple — conferir antes "
                    "de assumir que as TAGs estao fora de area."
                )
            espera = _intervalo_do_plano(backend)
        except Exception:
            log.exception("ciclo falhou")
            espera = INTERVALO_APOS_ERRO_S

        time.sleep(espera)


if __name__ == "__main__":
    main()
```

- [ ] **Step 8: Escrever o Dockerfile e o `.env.example`**

Criar `ktag-findmy-worker/Dockerfile`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY findmy_worker/ ./findmy_worker/

VOLUME ["/data/outbox", "/data/sessao-apple"]

CMD ["python", "-m", "findmy_worker.main"]
```

Criar `ktag-findmy-worker/.env.example`:

```
# Backend do 21 GO
BACKEND_URL=https://api.trackgo.site/api/v1
BACKEND_TOKEN=

# Proxy residencial — obrigatorio. Sem ele a Apple devolve lista vazia.
APPLE_PROXY=http://usuario:senha@host:porta

# Anisette (gera os headers de autenticacao da Apple)
ANISETTE_URL=http://anisette:6969

# Pastas persistentes
OUTBOX_DIR=/data/outbox
APPLE_SESSION_DIR=/data/sessao-apple
```

- [ ] **Step 9: Escrever o README do worker**

Criar `ktag-findmy-worker/README.md` explicando, em prosa curta: o que o worker faz; que o proxy residencial é obrigatório porque a Apple barra datacenter; que o login é feito uma vez com `--trusteddevice` porque o 2FA por SMS está quebrado; que a conta Apple precisa ter sido usada num iPhone real antes, senão a Apple recusa devolver dados; e como rodar os testes (`python -m pytest -q`).

- [ ] **Step 10: Rodar a suíte inteira**

Run: `cd ktag-findmy-worker && python -m pytest -q`
Expected: PASS, 21/21.

- [ ] **Step 11: Commit**

```bash
git add ktag-findmy-worker
git commit -m "feat(ktag): ciclo do worker, clientes e empacotamento"
```

---

### Task 8: A tela mostra a idade e a origem da posição

**Files:**
- Modify: `frontend/dashboard/src/types/ble-tag.ts`
- Modify: `frontend/dashboard/src/app/(dashboard)/etiquetas-ble/page.tsx`

**Interfaces:**
- Consumes: campos `seenAt`, `accuracy` e `rssi` nulo, vindos da Task 1.
- Produces: nada consumido por outra task.

O frontend não tem suíte de testes — a verificação é lint + build.

- [ ] **Step 1: Atualizar os tipos**

Em `frontend/dashboard/src/types/ble-tag.ts`, três mudanças:

Em `interface BleSighting`, trocar `rssi: number;` por `rssi: number | null;` e acrescentar, logo abaixo:

```typescript
  accuracy: number | null;
  seenAt: string;
```

Em `interface BleTag`, o campo `bleSightings` passa a incluir os campos novos:

```typescript
  bleSightings: Array<Pick<BleSighting, 'id' | 'macAddress' | 'rssi' | 'accuracy' | 'seenAt' | 'scannerLat' | 'scannerLng' | 'scannerSource' | 'createdAt'>>;
```

Em `interface BleSightingEvent`, dentro de `sighting`, trocar `rssi: number;` por `rssi: number | null;` e acrescentar `accuracy: number | null;` e `seenAt: string;`.

- [ ] **Step 2: Escrever o rótulo de idade**

Em `frontend/dashboard/src/app/(dashboard)/etiquetas-ble/page.tsx`, acrescentar logo acima de `function rssiQuality` (linha 20):

```typescript
/**
 * Posição de TAG nunca é tempo real: ela depende de alguém passar perto. A
 * idade vai sempre na cara do operador para que ninguém trate uma posição de
 * meia hora atrás como a posição atual do veículo.
 */
function idadeLegivel(seenAt: string): string {
  const minutos = Math.floor((Date.now() - new Date(seenAt).getTime()) / 60000);
  if (minutos < 1) return 'visto agora';
  if (minutos < 60) return `visto há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `visto há ${horas}h`;
  return `visto há ${Math.floor(horas / 24)}d`;
}

const ORIGEM_LEGIVEL: Record<string, string> = {
  'apple-findmy': 'rede Apple',
  'ble-local': 'Bluetooth próprio',
};
```

- [ ] **Step 3: Fazer o indicador de sinal aceitar ausência de RSSI**

Na linha 20 do mesmo arquivo, `rssiQuality` hoje assume que sempre existe um número. Relatório da rede Apple não tem RSSI. Trocar a assinatura por:

```typescript
function rssiQuality(rssi: number | null): { label: string; color: string } | null {
  if (rssi === null) return null;
  if (rssi >= -55) return { label: 'Excelente', color: 'text-emerald-400' };
```

O resto do corpo da função fica como está.

- [ ] **Step 4: Usar na tela**

Ainda em `page.tsx`, três substituições.

Na linha 165, o cálculo de `quality` passa a lidar com o nulo:

```typescript
                    const quality = lastSighting ? rssiQuality(lastSighting.rssi) : null;
                    const idade = lastSighting ? idadeLegivel(lastSighting.seenAt) : null;
```

Na célula do sinal (o bloco `{lastSighting && quality ? (`), substituir o conteúdo inteiro da `<td>` por:

```tsx
                        <td className="px-4 py-3">
                          {lastSighting && quality ? (
                            <div>
                              <div className={`font-mono text-xs ${quality.color}`}>
                                {lastSighting.rssi} dBm
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {quality.label}
                              </div>
                            </div>
                          ) : lastSighting && lastSighting.accuracy !== null ? (
                            <div>
                              <div className="font-mono text-xs text-muted-foreground">
                                ±{lastSighting.accuracy} m
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                precisão estimada
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
```

Na célula da origem (linha 216, `{lastSighting?.scannerSource || '—'}`), substituir a `<td>` inteira por:

```tsx
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {lastSighting ? (
                            <div>
                              <div>
                                {ORIGEM_LEGIVEL[lastSighting.scannerSource ?? ''] ??
                                  'origem desconhecida'}
                              </div>
                              <div className="text-[10px]">{idade}</div>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
```

- [ ] **Step 5: Verificar**

Run: `cd frontend/dashboard && npx next lint && npx tsc --noEmit`
Expected: sem erro de lint e sem erro de tipo.

- [ ] **Step 6: Commit**

```bash
git add frontend/dashboard/src
git commit -m "feat(ktag): tela mostra ha quanto tempo a TAG foi vista e por qual via"
```

---

## Fora deste plano

Estes itens do spec **não** têm task e é intencional:

- **Aquecer a conta Apple** e **contratar o proxy residencial** são pré-requisitos externos, executados pelo dono. Nenhuma linha de código os substitui.
- **Login interativo com `--trusteddevice`** é operação manual de uma vez, feita com o iPhone em mãos; o worker apenas restaura a sessão gravada.
- **Teste de campo** com a TAG na rua é o critério que decide se a tecnologia serve, e acontece depois de tudo isto estar no ar.
- **Cadastrar as chaves da TAG no banco** é operação de dados (as chaves já existem em `poc-ktag-findmy/keys/ktag-92603008494.json`), não código novo.
