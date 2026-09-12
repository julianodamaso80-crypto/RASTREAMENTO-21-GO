# Aba Boletos no app do associado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao associado uma aba Boletos no app (Android e iOS) que mostra os boletos em aberto de todos os veículos dele, com linha digitável e PDF que funcionam a qualquer hora, e um push quando o boleto fica disponível.

**Architecture:** Três repositórios, três papéis. O **CRM** já espelha os 103.556 boletos do SGA e já tem as regras julgadas (pago, cancelado, expirado, 5 dias) — ele ganha uma rota de integração e continua sendo o único dono da regra financeira. O **backend do rastreamento** ganha um robô que, dentro da janela em que o SGA aceita conexão (seg–sex 7h–18h), pergunta ao CRM, guarda linha digitável e PDF no Postgres, e serve tudo isso ao app a partir do espelho local — por isso a aba funciona sábado e às 23h. O **app** ganha a aba, os dois botões e a notificação.

**Tech Stack:** NestJS 11 + Prisma + PostgreSQL 17 (rastreamento) · Fastify + Prisma (CRM) · Expo SDK 54 + expo-router (app) · Jest nos três.

## Global Constraints

Valores copiados do spec. Valem para **todas** as tarefas.

- **Multi-tenant:** toda query do backend do rastreamento filtra por `tenantId`, inclusive `findFirst`/`findUnique`.
- **Regra dos 5 dias:** 5 dias de atraso ainda mostra; 6 não. A constante que manda é `DIAS_PARA_EMITIR = 5` do CRM.
- **Pago no SGA:** códigos `1` e `4`, ou `data_pagamento` preenchida. **Cancelado:** códigos `3` e `999`.
- **Segredo interno nunca chega ao associado:** nenhuma resposta de `/app/*` pode conter IMEI, host, porta, comando de servidor, APN, chip ou TAG. Allowlist explícita, com teste de contrato envenenado.
- **Texto do Setor de Boletos, literal, sem mudar uma vírgula:** `Para dúvidas e informações, fale com nosso Setor de Boletos:` / `📞 (21) 95933-5359 | (21) 98142-2100`
- **Imports do Prisma Client no rastreamento:** `.prisma/client`, nunca `@prisma/client`.
- **Migrations aditivas**, nomeadas `YYYYMMDDHHMMSS_<assunto>`. Nunca `drizzle-kit push`, nunca seed contra produção.
- **Soft delete:** nada de `delete()` físico em entidade de domínio. (A limpeza de boleto pago é exceção explícita: espelho descartável, aprovado no spec.)
- **`newArchEnabled: false`** no app — New Architecture trava o boot do JS no iOS 26.
- **Expo SDK 54**, app `com.r21go.client`, projeto EAS `f2b12e95-4908-41f6-b8b8-9a8a61dfe270`.
- **Commits em português**, formato `tipo(escopo): descrição`.
- **`git add` sempre por arquivo**, nunca por diretório — há sessões paralelas na mesma árvore.

## Estrutura de arquivos

**CRM** (`C:\Users\damas\Documents\PROJETOS\21 GO\21 GO - CRM`)

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/modules/integracao/integracao-boletos.regras.ts` | puro: o que é "em aberto", o que o app pode ver |
| `backend/src/modules/integracao/integracao-boletos.regras.test.ts` | testes das regras |
| `backend/src/modules/integracao/integracao.routes.ts` | rota HTTP + conferência do segredo |
| `backend/src/modules/integracao/integracao.auth.test.ts` | testes do segredo |
| `backend/src/config/env.ts` (modificar) | `INTEGRACAO_TOKEN` |
| `backend/src/server.ts` (modificar) | registrar o prefixo `/api/integracao` |

**Backend do rastreamento** (`C:\Users\damas\Documents\PROJETOS\21 GO\21 - RASTREAMENTO`)

| Arquivo | Responsabilidade |
|---|---|
| `backend/prisma/migrations/20260913090000_boletos_do_associado/migration.sql` | DDL aditiva |
| `backend/prisma/schema.prisma` (modificar) | models `AssociateBoleto`, `AssociateBoletoPdf`, `AssociatePushDevice` |
| `backend/src/modules/boletos/boletos.regras.ts` | puro: o que a aba mostra, rótulo de vencimento |
| `backend/src/modules/boletos/boletos.regras.spec.ts` | testes das regras |
| `backend/src/modules/boletos/crm-boletos.client.ts` | fala com o CRM |
| `backend/src/modules/boletos/crm-boletos.client.spec.ts` | testes do cliente |
| `backend/src/modules/boletos/boletos.service.ts` | leitura do espelho para o app |
| `backend/src/modules/boletos/boletos.controller.ts` | `/app/boletos`, `/app/boletos/:id/pdf` |
| `backend/src/modules/boletos/boletos-contrato.spec.ts` | contrato envenenado |
| `backend/src/modules/boletos/boletos-sync.service.ts` | o robô (cron + janela + limpeza) |
| `backend/src/modules/boletos/boletos-sync.service.spec.ts` | testes do robô |
| `backend/src/modules/boletos/push.service.ts` | envio ao Expo + trava `avisadoEm` |
| `backend/src/modules/boletos/push.service.spec.ts` | testes do push |
| `backend/src/modules/boletos/boletos.module.ts` | amarra tudo |
| `backend/src/config/configuration.ts` (modificar) | bloco `crm` e `expoPush` |
| `backend/src/app.module.ts` (modificar) | importa `BoletosModule` |

**App** (`...\21 - RASTREAMENTO\mobile`)

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/boletos.ts` | puro: rótulo de vencimento e ordenação |
| `src/lib/boletos.test.ts` | testes |
| `src/lib/api.ts` (modificar) | tipos + `AppApi.boletos()` e `registrarPush()` |
| `src/app/(tabs)/boletos.tsx` | a tela |
| `src/app/(tabs)/_layout.tsx` (modificar) | a aba entre Trajetos e Perfil |
| `src/lib/push.ts` | permissão + token + deep link |
| `app.json` (modificar) | plugin de notificações, versão |

---

### Task 1: CRM — regras da rota de integração (puro)

**Files:**
- Create: `backend/src/modules/integracao/integracao-boletos.regras.ts`
- Test: `backend/src/modules/integracao/integracao-boletos.regras.test.ts`

**Interfaces:**
- Consumes: `DIAS_PARA_EMITIR`, `foraDoPrazoDeEmissao` de `../rede/boleto-ao-vivo`
- Produces:
  - `type BoletoDoApp = { nossoNumero: string; placa: string | null; mesReferente: string | null; valor: number | null; vencimento: string | null; status: 'disponivel' | 'pago' | 'cancelado' | 'expirado' | 'fora_do_prazo'; linhaDigitavel: string | null; linkPdf: string | null }`
  - `function diasDeAtrasoEm(vencimento: string | null, hoje: Date): number`
  - `function entraNaAba(linha: { status: string | null; dataVencimento: string | null }, hoje: Date): boolean`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/modules/integracao/integracao-boletos.regras.test.ts
import { describe, it, expect } from 'vitest'
import { diasDeAtrasoEm, entraNaAba } from './integracao-boletos.regras'

const HOJE = new Date('2026-09-12T12:00:00-03:00')

describe('diasDeAtrasoEm', () => {
  it('boleto a vencer tem atraso zero, nunca negativo', () => {
    expect(diasDeAtrasoEm('2026-09-20', HOJE)).toBe(0)
  })
  it('vencido ontem tem 1 dia', () => {
    expect(diasDeAtrasoEm('2026-09-11', HOJE)).toBe(1)
  })
  it('sem vencimento tem atraso zero', () => {
    expect(diasDeAtrasoEm(null, HOJE)).toBe(0)
  })
})

describe('entraNaAba — a regra dos 5 dias do dono', () => {
  it('a vencer entra', () => {
    expect(entraNaAba({ status: 'a_vencer', dataVencimento: '2026-09-20' }, HOJE)).toBe(true)
  })
  it('vencido ha 5 dias ainda entra', () => {
    expect(entraNaAba({ status: 'vencido', dataVencimento: '2026-09-07' }, HOJE)).toBe(true)
  })
  it('vencido ha 6 dias NAO entra', () => {
    expect(entraNaAba({ status: 'vencido', dataVencimento: '2026-09-06' }, HOJE)).toBe(false)
  })
  it('pago nunca entra', () => {
    expect(entraNaAba({ status: 'pago', dataVencimento: '2026-09-10' }, HOJE)).toBe(false)
  })
  it('cancelado nunca entra', () => {
    expect(entraNaAba({ status: 'cancelado', dataVencimento: '2026-09-10' }, HOJE)).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "C:\Users\damas\Documents\PROJETOS\21 GO\21 GO - CRM" && npx vitest run backend/src/modules/integracao/integracao-boletos.regras.test.ts`
Expected: FAIL — `Failed to resolve import "./integracao-boletos.regras"`

- [ ] **Step 3: Escrever a implementação mínima**

```ts
// backend/src/modules/integracao/integracao-boletos.regras.ts
import { foraDoPrazoDeEmissao } from '../rede/boleto-ao-vivo'

/** O boleto como o app do associado o vê. Nada além destes campos sai daqui. */
export type BoletoDoApp = {
  nossoNumero: string
  placa: string | null
  mesReferente: string | null
  valor: number | null
  vencimento: string | null
  status: 'disponivel' | 'pago' | 'cancelado' | 'expirado' | 'fora_do_prazo'
  linhaDigitavel: string | null
  linkPdf: string | null
}

const UM_DIA_MS = 86_400_000

/** Dias inteiros de atraso. Nunca negativo: boleto a vencer tem atraso zero. */
export function diasDeAtrasoEm(vencimento: string | null, hoje: Date): number {
  if (!vencimento) return 0
  const venc = new Date(`${vencimento}T00:00:00-03:00`).getTime()
  const hojeZero = new Date(
    `${hoje.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })}T00:00:00-03:00`,
  ).getTime()
  const dias = Math.floor((hojeZero - venc) / UM_DIA_MS)
  return dias > 0 ? dias : 0
}

/**
 * A aba só mostra o que o associado PODE pagar: boleto aberto e dentro dos 5 dias.
 * Pago e cancelado somem; 6 dias de atraso some — regra do dono de 12/08/2026.
 */
export function entraNaAba(
  linha: { status: string | null; dataVencimento: string | null },
  hoje: Date,
): boolean {
  if (linha.status !== 'a_vencer' && linha.status !== 'vencido') return false
  return !foraDoPrazoDeEmissao(diasDeAtrasoEm(linha.dataVencimento, hoje))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run backend/src/modules/integracao/integracao-boletos.regras.test.ts`
Expected: PASS — 8 testes

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\damas\Documents\PROJETOS\21 GO\21 GO - CRM"
git add backend/src/modules/integracao/integracao-boletos.regras.ts backend/src/modules/integracao/integracao-boletos.regras.test.ts
git commit -m "feat(integracao): regras do boleto que o app do associado ve"
```

> O CRM roda **Vitest** (`"test": "vitest"` em `backend/package.json`, conferido em 12/09/2026) — por isso o `import { describe, it, expect } from 'vitest'` no topo do teste.

---

### Task 2: CRM — a rota `/api/integracao/boletos`

**Files:**
- Create: `backend/src/modules/integracao/integracao.routes.ts`
- Create: `backend/src/modules/integracao/integracao.auth.test.ts`
- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/server.ts`

**Interfaces:**
- Consumes: `entraNaAba`, `diasDeAtrasoEm`, `BoletoDoApp` (Task 1); `buscarBoletoPorNumero` de `../boletos/boleto-vivo`; `boletoForaDoPrazo` de `../rede/boleto-ao-vivo`; `prisma` de `../../config/database`
- Produces: `GET /api/integracao/boletos?cpf=<dígitos>` → `{ boletos: BoletoDoApp[] }`; `function segredoConfere(header: string | undefined, esperado: string): boolean`

- [ ] **Step 1: Escrever o teste do segredo**

```ts
// backend/src/modules/integracao/integracao.auth.test.ts
import { describe, it, expect } from 'vitest'
import { segredoConfere } from './integracao.routes'

describe('segredoConfere', () => {
  it('aceita o Bearer certo', () => {
    expect(segredoConfere('Bearer abc123', 'abc123')).toBe(true)
  })
  it('recusa segredo errado', () => {
    expect(segredoConfere('Bearer errado', 'abc123')).toBe(false)
  })
  it('recusa header ausente', () => {
    expect(segredoConfere(undefined, 'abc123')).toBe(false)
  })
  it('recusa quando o esperado esta vazio — porta nunca fica aberta por env faltando', () => {
    expect(segredoConfere('Bearer ', '')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run backend/src/modules/integracao/integracao.auth.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Escrever a rota**

```ts
// backend/src/modules/integracao/integracao.routes.ts
import { FastifyInstance } from 'fastify'
import { prisma } from '../../config/database'
import { env } from '../../config/env'
import { buscarBoletoPorNumero } from '../boletos/boleto-vivo'
import { boletoForaDoPrazo } from '../rede/boleto-ao-vivo'
import { BoletoDoApp, diasDeAtrasoEm, entraNaAba } from './integracao-boletos.regras'

const COMPANY = 'company-21go'

/** Segredo compartilhado. Env vazia NUNCA libera — a porta fecha, não abre. */
export function segredoConfere(header: string | undefined, esperado: string): boolean {
  if (!esperado) return false
  return header === `Bearer ${esperado}`
}

export async function integracaoRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { cpf?: string } }>('/boletos', async (req, reply) => {
    if (!segredoConfere(req.headers.authorization, env.INTEGRACAO_TOKEN ?? '')) {
      return reply.status(401).send({ message: 'Não autorizado.' })
    }
    const cpf = String(req.query.cpf ?? '').replace(/\D/g, '')
    if (cpf.length !== 11 && cpf.length !== 14) {
      return reply.status(400).send({ message: 'CPF ou CNPJ inválido.' })
    }

    const linhas = await prisma.redeBoleto.findMany({
      where: { companyId: COMPANY, cpfAssociado: cpf, status: { in: ['a_vencer', 'vencido'] } },
      select: {
        nossoNumero: true, placa: true, mesReferente: true,
        valor: true, dataVencimento: true, status: true,
      },
      orderBy: { dataVencimento: 'asc' },
    })

    const hoje = new Date()
    const boletos: BoletoDoApp[] = []
    for (const l of linhas.filter((x) => entraNaAba(x, hoje))) {
      const valor = l.valor != null ? Number(l.valor) : null
      const base = {
        nossoNumero: l.nossoNumero,
        placa: l.placa ?? null,
        mesReferente: l.mesReferente ?? null,
        valor,
        vencimento: l.dataVencimento ?? null,
      }
      try {
        const vivo = await buscarBoletoPorNumero(l.nossoNumero)
        if (vivo.status === 'pago' || vivo.status === 'cancelado') continue
        const atraso = diasDeAtrasoEm(l.dataVencimento, hoje)
        const r = atraso > 5 ? boletoForaDoPrazo(l.dataVencimento ?? '', valor) : vivo
        boletos.push({
          ...base,
          status: r.status as BoletoDoApp['status'],
          linhaDigitavel: r.linhaDigitavel,
          linkPdf: r.link,
        })
      } catch (err) {
        /**
         * SGA fora da janela, instabilidade, timeout: devolve o que o espelho sabe.
         * O app precisa do valor e do vencimento mesmo num sábado — e nunca de um erro cru.
         */
        req.log.warn({ err, nossoNumero: l.nossoNumero }, 'boleto ao vivo indisponivel')
        boletos.push({ ...base, status: 'disponivel', linhaDigitavel: null, linkPdf: null })
      }
    }
    return reply.send({ boletos })
  })
}
```

- [ ] **Step 4: Registrar env e rota**

Em `backend/src/config/env.ts`, junto das outras chaves do schema zod:

```ts
  INTEGRACAO_TOKEN: z.string().optional(),
```

Em `backend/src/server.ts`, junto dos outros `register` (perto da linha 320):

```ts
    await fastify.register(integracaoRoutes, { prefix: '/api/integracao' })
```

E o import no topo, junto dos outros:

```ts
import { integracaoRoutes } from './modules/integracao/integracao.routes'
```

- [ ] **Step 5: Rodar os testes e o build**

Run: `npx vitest run backend/src/modules/integracao/ && npx tsc --noEmit -p backend/tsconfig.json`
Expected: PASS nos 12 testes, zero erro de tipo

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/integracao/integracao.routes.ts backend/src/modules/integracao/integracao.auth.test.ts backend/src/config/env.ts backend/src/server.ts
git commit -m "feat(integracao): rota de boletos do associado para o app de rastreamento"
```

---

### Task 3: Rastreamento — tabelas do espelho

**Files:**
- Create: `backend/prisma/migrations/20260913090000_boletos_do_associado/migration.sql`
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: models `AssociateBoleto`, `AssociateBoletoPdf`, `AssociatePushDevice` no Prisma Client

- [ ] **Step 1: Escrever a migration**

```sql
-- backend/prisma/migrations/20260913090000_boletos_do_associado/migration.sql
-- Espelho dos boletos que o app mostra. Descartável: a fonte é o CRM.
CREATE TABLE IF NOT EXISTS "associate_boletos" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       UUID NOT NULL,
  "associate_id"    UUID NOT NULL,
  "nosso_numero"    TEXT NOT NULL,
  "plate"           TEXT,
  "mes_referente"   TEXT,
  "valor"           DECIMAL(12,2),
  "vencimento"      TEXT,
  "status"          TEXT NOT NULL,
  "linha_digitavel" TEXT,
  "pdf_bytes"       INTEGER,
  "avisado_em"      TIMESTAMPTZ,
  "atualizado_em"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "criado_em"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "associate_boletos_tenant_numero_key"
  ON "associate_boletos" ("tenant_id", "nosso_numero");
CREATE INDEX IF NOT EXISTS "associate_boletos_associate_idx"
  ON "associate_boletos" ("associate_id", "vencimento");

-- O PDF mora em tabela à parte: 3,4 MB por linha não pode pesar a consulta da lista.
CREATE TABLE IF NOT EXISTS "associate_boleto_pdfs" (
  "nosso_numero" TEXT PRIMARY KEY,
  "tenant_id"    UUID NOT NULL,
  "conteudo"     BYTEA NOT NULL,
  "baixado_em"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Aparelho que recebe push. Uma linha por aparelho, não por pessoa.
CREATE TABLE IF NOT EXISTS "associate_push_devices" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    UUID NOT NULL,
  "associate_id" UUID NOT NULL,
  "expo_token"   TEXT NOT NULL,
  "platform"     TEXT NOT NULL,
  "atualizado_em" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "associate_push_devices_token_key"
  ON "associate_push_devices" ("expo_token");
CREATE INDEX IF NOT EXISTS "associate_push_devices_associate_idx"
  ON "associate_push_devices" ("associate_id");

-- Sem isto, "lista vazia" é ambíguo: não dá para saber se o associado está em dia
-- ou se o robô ainda não passou por ele. NULL = nunca carregado.
ALTER TABLE "associates"
  ADD COLUMN IF NOT EXISTS "boletos_sincronizados_em" TIMESTAMPTZ;
```

- [ ] **Step 2: Espelhar no schema.prisma**

No model `Associate` (por volta da linha 592, junto de `phoneVerifiedAt`):

```prisma
  /// Quando o robô de boletos passou por este associado pela última vez.
  /// NULL = nunca passou: a aba diz "aparecem a partir de segunda", em vez de
  /// dizer que ele está em dia sem ter olhado.
  boletosSincronizadosEm DateTime? @map("boletos_sincronizados_em") @db.Timestamptz()
```

E adicionar ao fim de `backend/prisma/schema.prisma`:

```prisma
/// Boleto do associado, espelhado do CRM. Descartável: some quando pago ou
/// quando passa dos 5 dias de atraso — a fonte da verdade é o CRM.
model AssociateBoleto {
  id             String    @id @default(uuid()) @db.Uuid
  tenantId       String    @map("tenant_id") @db.Uuid
  associateId    String    @map("associate_id") @db.Uuid
  nossoNumero    String    @map("nosso_numero")
  plate          String?
  mesReferente   String?   @map("mes_referente")
  valor          Decimal?  @db.Decimal(12, 2)
  vencimento     String?
  status         String
  linhaDigitavel String?   @map("linha_digitavel")
  pdfBytes       Int?      @map("pdf_bytes")
  /// Trava do push: uma vez por boleto, para sempre.
  avisadoEm      DateTime? @map("avisado_em") @db.Timestamptz()
  atualizadoEm   DateTime  @default(now()) @updatedAt @map("atualizado_em") @db.Timestamptz()
  criadoEm       DateTime  @default(now()) @map("criado_em") @db.Timestamptz()

  @@unique([tenantId, nossoNumero])
  @@index([associateId, vencimento])
  @@map("associate_boletos")
}

/// O PDF em si. Tabela à parte porque são ~3,4 MB por boleto.
model AssociateBoletoPdf {
  nossoNumero String   @id @map("nosso_numero")
  tenantId    String   @map("tenant_id") @db.Uuid
  conteudo    Bytes
  baixadoEm   DateTime @default(now()) @map("baixado_em") @db.Timestamptz()

  @@map("associate_boleto_pdfs")
}

/// Aparelho do associado que recebe push. Uma linha por aparelho.
model AssociatePushDevice {
  id           String   @id @default(uuid()) @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  associateId  String   @map("associate_id") @db.Uuid
  expoToken    String   @unique @map("expo_token")
  platform     String
  atualizadoEm DateTime @default(now()) @updatedAt @map("atualizado_em") @db.Timestamptz()

  @@index([associateId])
  @@map("associate_push_devices")
}
```

- [ ] **Step 3: Gerar o client e conferir que o schema bate**

Run: `cd "C:\Users\damas\Documents\PROJETOS\21 GO\21 - RASTREAMENTO\backend" && npx prisma generate && npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_URL" --exit-code`
Expected: exit 0 — a migration escrita cobre o schema. Se sair 2, a DDL divergiu do model: corrija a DDL, nunca rode `prisma migrate dev` contra produção.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/migrations/20260913090000_boletos_do_associado/migration.sql backend/prisma/schema.prisma
git commit -m "feat(boletos): tabelas do espelho de boletos e do aparelho de push"
```

---

### Task 4: Rastreamento — regras da aba (puro)

**Files:**
- Create: `backend/src/modules/boletos/boletos.regras.ts`
- Test: `backend/src/modules/boletos/boletos.regras.spec.ts`

**Interfaces:**
- Produces:
  - `const TELEFONE_SETOR_BOLETOS: { titulo: string; telefones: string }`
  - `function rotuloVencimento(vencimento: string | null, hoje: Date): string`
  - `function aindaPodePagar(vencimento: string | null, hoje: Date): boolean`
  - `function dentroDaJanelaDoSga(agora: Date): boolean`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/modules/boletos/boletos.regras.spec.ts
import {
  TELEFONE_SETOR_BOLETOS,
  aindaPodePagar,
  dentroDaJanelaDoSga,
  rotuloVencimento,
} from './boletos.regras';

const HOJE = new Date('2026-09-12T12:00:00-03:00');

describe('rotuloVencimento — a frase que o associado lê', () => {
  it('vence hoje', () => {
    expect(rotuloVencimento('2026-09-12', HOJE)).toBe('vence hoje');
  });
  it('vence amanha fala no singular', () => {
    expect(rotuloVencimento('2026-09-13', HOJE)).toBe('vence amanhã');
  });
  it('vence em 8 dias', () => {
    expect(rotuloVencimento('2026-09-20', HOJE)).toBe('vence em 8 dias');
  });
  it('venceu ontem fala no singular', () => {
    expect(rotuloVencimento('2026-09-11', HOJE)).toBe('venceu ontem');
  });
  it('venceu ha 3 dias', () => {
    expect(rotuloVencimento('2026-09-09', HOJE)).toBe('venceu há 3 dias');
  });
  it('sem vencimento nao inventa frase', () => {
    expect(rotuloVencimento(null, HOJE)).toBe('');
  });
});

describe('aindaPodePagar — 5 emite, 6 nao', () => {
  it('a vencer pode', () => {
    expect(aindaPodePagar('2026-09-20', HOJE)).toBe(true);
  });
  it('5 dias de atraso ainda pode', () => {
    expect(aindaPodePagar('2026-09-07', HOJE)).toBe(true);
  });
  it('6 dias de atraso nao pode', () => {
    expect(aindaPodePagar('2026-09-06', HOJE)).toBe(false);
  });
});

describe('dentroDaJanelaDoSga — medido em 12/09/2026', () => {
  it('sabado ao meio-dia esta FORA (10.341 recusas medidas)', () => {
    expect(dentroDaJanelaDoSga(new Date('2026-09-12T12:00:00-03:00'))).toBe(false);
  });
  it('segunda as 9h esta dentro', () => {
    expect(dentroDaJanelaDoSga(new Date('2026-09-14T09:00:00-03:00'))).toBe(true);
  });
  it('sexta as 20h esta fora', () => {
    expect(dentroDaJanelaDoSga(new Date('2026-09-11T20:00:00-03:00'))).toBe(false);
  });
  it('domingo esta fora', () => {
    expect(dentroDaJanelaDoSga(new Date('2026-09-13T10:00:00-03:00'))).toBe(false);
  });
});

describe('texto do Setor de Boletos', () => {
  it('e exatamente o que o dono escreveu', () => {
    expect(TELEFONE_SETOR_BOLETOS.titulo).toBe(
      'Para dúvidas e informações, fale com nosso Setor de Boletos:',
    );
    expect(TELEFONE_SETOR_BOLETOS.telefones).toBe('📞 (21) 95933-5359 | (21) 98142-2100');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "C:\Users\damas\Documents\PROJETOS\21 GO\21 - RASTREAMENTO\backend" && npx jest src/modules/boletos/boletos.regras.spec.ts`
Expected: FAIL — `Cannot find module './boletos.regras'`

- [ ] **Step 3: Escrever a implementação**

```ts
// backend/src/modules/boletos/boletos.regras.ts

/** Regra do dono, 12/08/2026: 5 dias de atraso ainda emite; 6 não. */
export const DIAS_PARA_EMITIR = 5;

/** Texto literal do dono (12/09/2026). Não reescrever, não abreviar. */
export const TELEFONE_SETOR_BOLETOS = {
  titulo: 'Para dúvidas e informações, fale com nosso Setor de Boletos:',
  telefones: '📞 (21) 95933-5359 | (21) 98142-2100',
} as const;

const UM_DIA_MS = 86_400_000;

function diaEmBrasilia(d: Date): number {
  const iso = d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return new Date(`${iso}T00:00:00-03:00`).getTime();
}

/** Dias até o vencimento. Negativo = já venceu. */
function diasAte(vencimento: string, hoje: Date): number {
  const venc = new Date(`${vencimento}T00:00:00-03:00`).getTime();
  return Math.round((venc - diaEmBrasilia(hoje)) / UM_DIA_MS);
}

export function rotuloVencimento(vencimento: string | null, hoje: Date): string {
  if (!vencimento) return '';
  const dias = diasAte(vencimento, hoje);
  if (dias === 0) return 'vence hoje';
  if (dias === 1) return 'vence amanhã';
  if (dias > 1) return `vence em ${dias} dias`;
  if (dias === -1) return 'venceu ontem';
  return `venceu há ${Math.abs(dias)} dias`;
}

export function aindaPodePagar(vencimento: string | null, hoje: Date): boolean {
  if (!vencimento) return true;
  const atraso = -diasAte(vencimento, hoje);
  return atraso <= DIAS_PARA_EMITIR;
}

/**
 * A janela em que o SGA aceita a credencial. MEDIDO em 12/09/2026, não presumido:
 * a liberação "00h–23h todo dia" não foi aplicada — sábado ao meio-dia deu 401 em
 * 10.341 tentativas. Vale seg–sex, 7h–18h de Brasília. Se a Hinova liberar de
 * verdade, é esta função que muda, e só ela.
 */
export function dentroDaJanelaDoSga(agora: Date): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  });
  const partes = Object.fromEntries(fmt.formatToParts(agora).map((p) => [p.type, p.value]));
  const diaUtil = !['Sat', 'Sun'].includes(partes.weekday as string);
  const hora = Number(partes.hour);
  return diaUtil && hora >= 7 && hora < 18;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/boletos/boletos.regras.spec.ts`
Expected: PASS — 14 testes

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\damas\Documents\PROJETOS\21 GO\21 - RASTREAMENTO"
git add backend/src/modules/boletos/boletos.regras.ts backend/src/modules/boletos/boletos.regras.spec.ts
git commit -m "feat(boletos): regras da aba — rotulo de vencimento, 5 dias e janela do SGA"
```

---

### Task 5: Rastreamento — cliente do CRM

**Files:**
- Create: `backend/src/modules/boletos/crm-boletos.client.ts`
- Test: `backend/src/modules/boletos/crm-boletos.client.spec.ts`
- Modify: `backend/src/config/configuration.ts`

**Interfaces:**
- Consumes: `ConfigService` do Nest
- Produces:
  - `interface BoletoDoCrm { nossoNumero: string; placa: string | null; mesReferente: string | null; valor: number | null; vencimento: string | null; status: string; linhaDigitavel: string | null; linkPdf: string | null }`
  - `class CrmBoletosClient { buscarPorCpf(cpf: string): Promise<BoletoDoCrm[]>; baixarPdf(url: string): Promise<Buffer | null> }`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/modules/boletos/crm-boletos.client.spec.ts
import { CrmBoletosClient } from './crm-boletos.client';

function client(fetchFake: jest.Mock) {
  const config = {
    get: (k: string) =>
      ({ 'crm.baseUrl': 'https://crm.test/api', 'crm.token': 'segredo' })[k],
  } as any;
  return new CrmBoletosClient(config, fetchFake as unknown as typeof fetch);
}

describe('CrmBoletosClient.buscarPorCpf', () => {
  it('manda o segredo no header e devolve a lista', async () => {
    const f = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ boletos: [{ nossoNumero: '1', status: 'disponivel' }] }),
    });
    const r = await client(f).buscarPorCpf('11144477735');
    expect(f.mock.calls[0][0]).toContain('cpf=11144477735');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer segredo');
    expect(r).toHaveLength(1);
  });

  it('CRM fora do ar devolve lista vazia, nunca explode', async () => {
    const f = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(client(f).buscarPorCpf('11144477735')).resolves.toEqual([]);
  });

  it('CRM respondendo 500 devolve lista vazia', async () => {
    const f = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(client(f).buscarPorCpf('11144477735')).resolves.toEqual([]);
  });
});

describe('CrmBoletosClient.baixarPdf', () => {
  it('so aceita conteudo que e PDF de verdade', async () => {
    const html = Buffer.from('<html>O prazo para emissao deste boleto expirou</html>');
    const f = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => html.buffer.slice(html.byteOffset, html.byteOffset + html.length),
    });
    // O link responde 200 mesmo morto: só o conteúdo prova (medido no CRM em 07/08/2026).
    await expect(client(f).baixarPdf('https://hinova.test/b.pdf')).resolves.toBeNull();
  });

  it('devolve o buffer quando e PDF', async () => {
    const pdf = Buffer.from('%PDF-1.4 conteudo');
    const f = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.length),
    });
    const r = await client(f).baixarPdf('https://hinova.test/b.pdf');
    expect(r?.subarray(0, 4).toString()).toBe('%PDF');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/boletos/crm-boletos.client.spec.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Escrever o cliente**

```ts
// backend/src/modules/boletos/crm-boletos.client.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface BoletoDoCrm {
  nossoNumero: string;
  placa: string | null;
  mesReferente: string | null;
  valor: number | null;
  vencimento: string | null;
  status: string;
  linhaDigitavel: string | null;
  linkPdf: string | null;
}

@Injectable()
export class CrmBoletosClient {
  private readonly logger = new Logger(CrmBoletosClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly buscar: typeof fetch = fetch,
  ) {}

  /** Lista do CRM. Qualquer falha vira lista vazia: a aba mostra o que já tem guardado. */
  async buscarPorCpf(cpf: string): Promise<BoletoDoCrm[]> {
    const base = this.config.get<string>('crm.baseUrl');
    const token = this.config.get<string>('crm.token');
    if (!base || !token) return [];
    try {
      const r = await this.buscar(`${base}/integracao/boletos?cpf=${encodeURIComponent(cpf)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) {
        this.logger.warn(`CRM respondeu ${r.status} ao listar boletos`);
        return [];
      }
      const body = (await r.json()) as { boletos?: BoletoDoCrm[] };
      return body.boletos ?? [];
    } catch (err) {
      this.logger.warn(`CRM indisponível: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Baixa o PDF. O link da Hinova responde 200 mesmo morto, com HTML de erro no
   * corpo — por isso quem prova é o conteúdo, não o status (medido no CRM, 07/08/2026).
   */
  async baixarPdf(url: string): Promise<Buffer | null> {
    try {
      const r = await this.buscar(url, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return buf.subarray(0, 4).toString() === '%PDF' ? buf : null;
    } catch (err) {
      this.logger.warn(`falhou ao baixar PDF: ${(err as Error).message}`);
      return null;
    }
  }
}
```

- [ ] **Step 4: Acrescentar o bloco de config**

Em `backend/src/config/configuration.ts`, depois do bloco `hinova`:

```ts
  crm: {
    // O CRM é a fonte da verdade financeira. Sem estas duas, a aba Boletos
    // simplesmente não carrega nada novo — e não quebra nada do resto.
    baseUrl: process.env.CRM_API_URL,
    token: process.env.CRM_INTEGRACAO_TOKEN,
  },
  expoPush: {
    url: process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send',
    enabled: process.env.EXPO_PUSH_ENABLED === 'true',
  },
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/modules/boletos/crm-boletos.client.spec.ts`
Expected: PASS — 5 testes

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/boletos/crm-boletos.client.ts backend/src/modules/boletos/crm-boletos.client.spec.ts backend/src/config/configuration.ts
git commit -m "feat(boletos): cliente do CRM com prova de PDF pelo conteudo"
```

---

### Task 6: Rastreamento — leitura da aba (`GET /app/boletos`)

**Files:**
- Create: `backend/src/modules/boletos/boletos.service.ts`
- Create: `backend/src/modules/boletos/boletos.controller.ts`
- Create: `backend/src/modules/boletos/boletos.module.ts`
- Test: `backend/src/modules/boletos/boletos-contrato.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `rotuloVencimento`, `aindaPodePagar`, `TELEFONE_SETOR_BOLETOS` (Task 4); `AssociateJwtGuard` e `CurrentAssociate` de `../app/`; `PrismaService`
- Produces:
  - `type BoletoDaAba = { id: string; placa: string | null; mesReferente: string | null; valor: number | null; vencimento: string | null; rotulo: string; linhaDigitavel: string | null; temPdf: boolean }`
  - `class BoletosService { listarDoAssociado(associateId: string, tenantId: string, agora?: Date): Promise<{ boletos: BoletoDaAba[]; rodape: typeof TELEFONE_SETOR_BOLETOS }> ; pdfDoBoleto(id: string, associateId: string, tenantId: string): Promise<Buffer | null> }`
  - `GET /app/boletos`, `GET /app/boletos/:id/pdf`

- [ ] **Step 1: Escrever o teste de contrato envenenado**

```ts
// backend/src/modules/boletos/boletos-contrato.spec.ts
import { BoletosService } from './boletos.service';

/** Linha do banco com campo interno plantado: nada disso pode chegar ao associado. */
const LINHA_ENVENENADA = {
  id: 'b1',
  plate: 'RJU0F75',
  mesReferente: '09/2026',
  valor: { toString: () => '250.57' },
  vencimento: '2026-09-20',
  status: 'disponivel',
  linhaDigitavel: '23793.38128',
  pdfBytes: 3_400_000,
  // veneno:
  imei: '865190071973955',
  serverHost: 'gps1.trackgo.site',
  serverPort: 5023,
  apn: 'claro.com.br',
  tagMac: 'AA:BB:CC:DD:EE:FF',
};

function service(linhas: unknown[], sincronizadoEm: Date | null = new Date('2026-09-12T08:00:00-03:00')) {
  const prisma = {
    associate: {
      findFirst: jest.fn().mockResolvedValue({ boletosSincronizadosEm: sincronizadoEm }),
    },
    associateBoleto: { findMany: jest.fn().mockResolvedValue(linhas) },
  } as any;
  return new BoletosService(prisma);
}

describe('GET /app/boletos — contrato com o associado', () => {
  const HOJE = new Date('2026-09-12T12:00:00-03:00');

  it('nenhum campo interno vaza, por mais que exista na linha', async () => {
    const r = await service([LINHA_ENVENENADA]).listarDoAssociado('a1', 't1', HOJE);
    const texto = JSON.stringify(r);
    for (const proibido of ['865190071973955', 'gps1.trackgo.site', '5023', 'claro.com.br', 'AA:BB:CC']) {
      expect(texto).not.toContain(proibido);
    }
    expect(Object.keys(r.boletos[0]).sort()).toEqual(
      ['id', 'linhaDigitavel', 'mesReferente', 'placa', 'rotulo', 'temPdf', 'valor', 'vencimento'].sort(),
    );
  });

  it('a query filtra por tenant E por associado', async () => {
    const s = service([]);
    const prisma = (s as any).prisma;
    await s.listarDoAssociado('a1', 't1', HOJE);
    const where = prisma.associateBoleto.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
    expect(where.associateId).toBe('a1');
  });

  it('lista vazia de quem o robo JA visitou = esta em dia', async () => {
    const r = await service([]).listarDoAssociado('a1', 't1', HOJE);
    expect(r.pendente).toBe(false);
  });

  it('lista vazia de quem o robo NUNCA visitou = pendente, nao "em dia"', async () => {
    const r = await service([], null).listarDoAssociado('a1', 't1', HOJE);
    expect(r.pendente).toBe(true);
  });

  it('boleto com 6 dias de atraso nao aparece, mesmo se sobrou no banco', async () => {
    const velho = { ...LINHA_ENVENENADA, vencimento: '2026-09-06' };
    const r = await service([velho]).listarDoAssociado('a1', 't1', HOJE);
    expect(r.boletos).toHaveLength(0);
  });

  it('o rodape do Setor de Boletos vem sempre, mesmo sem boleto', async () => {
    const r = await service([]).listarDoAssociado('a1', 't1', HOJE);
    expect(r.rodape.telefones).toBe('📞 (21) 95933-5359 | (21) 98142-2100');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/boletos/boletos-contrato.spec.ts`
Expected: FAIL — `Cannot find module './boletos.service'`

- [ ] **Step 3: Escrever o service**

```ts
// backend/src/modules/boletos/boletos.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TELEFONE_SETOR_BOLETOS, aindaPodePagar, rotuloVencimento } from './boletos.regras';

export type BoletoDaAba = {
  id: string;
  placa: string | null;
  mesReferente: string | null;
  valor: number | null;
  vencimento: string | null;
  rotulo: string;
  linhaDigitavel: string | null;
  temPdf: boolean;
};

@Injectable()
export class BoletosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lê SÓ do espelho local — nunca chama CRM nem SGA. É isso que faz a aba
   * funcionar no sábado, quando a credencial da Hinova está recusada.
   */
  async listarDoAssociado(
    associateId: string,
    tenantId: string,
    agora: Date = new Date(),
  ): Promise<{
    boletos: BoletoDaAba[];
    pendente: boolean;
    rodape: typeof TELEFONE_SETOR_BOLETOS;
  }> {
    const [associado, linhas] = await Promise.all([
      this.prisma.associate.findFirst({
        where: { id: associateId, tenantId },
        select: { boletosSincronizadosEm: true },
      }),
      this.prisma.associateBoleto.findMany({
        where: { tenantId, associateId, status: { notIn: ['pago', 'cancelado'] } },
        orderBy: { vencimento: 'asc' },
      }),
    ]);

    // Allowlist explícita: o objeto é montado campo a campo, nunca espalhado.
    const boletos = linhas
      .filter((l) => aindaPodePagar(l.vencimento, agora))
      .map((l) => ({
        id: l.id,
        placa: l.plate ?? null,
        mesReferente: l.mesReferente ?? null,
        valor: l.valor != null ? Number(l.valor) : null,
        vencimento: l.vencimento ?? null,
        rotulo: rotuloVencimento(l.vencimento, agora),
        linhaDigitavel: l.linhaDigitavel ?? null,
        temPdf: (l.pdfBytes ?? 0) > 0,
      }));

    /**
     * Lista vazia tem DOIS significados, e confundi-los é grave: dizer "você está
     * em dia" a quem o robô nunca visitou é mentir para quem deve. NULL = nunca
     * visitado, e a tela escreve que os boletos aparecem a partir de segunda.
     */
    return {
      boletos,
      pendente: !associado?.boletosSincronizadosEm,
      rodape: TELEFONE_SETOR_BOLETOS,
    };
  }

  /** O PDF guardado. Confere dono antes de entregar: id sozinho nunca basta. */
  async pdfDoBoleto(id: string, associateId: string, tenantId: string): Promise<Buffer | null> {
    const boleto = await this.prisma.associateBoleto.findFirst({
      where: { id, tenantId, associateId },
      select: { nossoNumero: true },
    });
    if (!boleto) return null;
    const pdf = await this.prisma.associateBoletoPdf.findFirst({
      where: { nossoNumero: boleto.nossoNumero, tenantId },
      select: { conteudo: true },
    });
    return pdf ? Buffer.from(pdf.conteudo) : null;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/boletos/boletos-contrato.spec.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Escrever o controller**

```ts
// backend/src/modules/boletos/boletos.controller.ts
import { Controller, Get, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { AssociateJwtGuard } from '../app/guards/associate-jwt.guard';
import { CurrentAssociate } from '../app/decorators/current-associate.decorator';
import { BoletosService } from './boletos.service';

@ApiTags('App - Boletos do Associado')
@ApiBearerAuth()
@Public()
@UseGuards(AssociateJwtGuard)
@Controller('app/boletos')
export class BoletosController {
  constructor(private readonly service: BoletosService) {}

  @Get()
  @ApiOperation({ summary: 'Boletos em aberto de todos os veículos do associado' })
  async listar(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
  ) {
    return this.service.listarDoAssociado(associateId, tenantId);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'PDF guardado do boleto' })
  async pdf(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Param('id') id: string,
    // @Res() sem passthrough: escapa do TransformInterceptor, que embrulharia
    // o binário em { data } e entregaria um PDF quebrado ao app.
    @Res() res: Response,
  ) {
    const pdf = await this.service.pdfDoBoleto(id, associateId, tenantId);
    if (!pdf) throw new NotFoundException('Boleto não encontrado.');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="boleto.pdf"');
    res.send(pdf);
  }
}
```

- [ ] **Step 6: Escrever o módulo e registrar**

```ts
// backend/src/modules/boletos/boletos.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BoletosController } from './boletos.controller';
import { BoletosService } from './boletos.service';
import { CrmBoletosClient } from './crm-boletos.client';
import { AssociateJwtGuard } from '../app/guards/associate-jwt.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.associateSecret')!,
      }),
    }),
  ],
  controllers: [BoletosController],
  providers: [BoletosService, CrmBoletosClient, AssociateJwtGuard],
  exports: [BoletosService, CrmBoletosClient],
})
export class BoletosModule {}
```

Em `backend/src/app.module.ts`, junto dos outros imports de módulo (perto da linha 123):

```ts
import { BoletosModule } from './modules/boletos/boletos.module';
// ... e dentro do array imports:
    BoletosModule,
```

- [ ] **Step 7: Compilar e rodar a suíte do módulo**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest src/modules/boletos`
Expected: zero erro de tipo, todos os testes verdes

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/boletos/boletos.service.ts backend/src/modules/boletos/boletos.controller.ts backend/src/modules/boletos/boletos.module.ts backend/src/modules/boletos/boletos-contrato.spec.ts backend/src/app.module.ts
git commit -m "feat(boletos): GET /app/boletos e o PDF guardado, com allowlist de campos"
```

---

### Task 7: Rastreamento — o robô de carga

**Files:**
- Create: `backend/src/modules/boletos/boletos-sync.service.ts`
- Test: `backend/src/modules/boletos/boletos-sync.service.spec.ts`
- Modify: `backend/src/modules/boletos/boletos.module.ts`

**Interfaces:**
- Consumes: `CrmBoletosClient` (Task 5); `dentroDaJanelaDoSga`, `aindaPodePagar` (Task 4); `PrismaService`
- Produces: `class BoletosSyncService { rodada(agora?: Date): Promise<{ associados: number; gravados: number; pdfs: number; apagados: number }> }`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/modules/boletos/boletos-sync.service.spec.ts
import { BoletosSyncService } from './boletos-sync.service';

const SABADO = new Date('2026-09-12T12:00:00-03:00');
const SEGUNDA = new Date('2026-09-14T09:00:00-03:00');

function monta(opts: { associados?: any[]; doCrm?: any[] } = {}) {
  const prisma = {
    associate: {
      findMany: jest.fn().mockResolvedValue(opts.associados ?? []),
      update: jest.fn().mockResolvedValue({}),
    },
    associateBoleto: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
    associateBoletoPdf: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _sum: { } }),
    },
  } as any;
  const crm = {
    buscarPorCpf: jest.fn().mockResolvedValue(opts.doCrm ?? []),
    baixarPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 x')),
  } as any;
  const push = { avisarBoletoNovo: jest.fn().mockResolvedValue(undefined) } as any;
  return { s: new BoletosSyncService(prisma, crm, push), prisma, crm, push };
}

describe('BoletosSyncService.rodada', () => {
  it('no sabado nao fala com ninguem — a credencial da Hinova esta recusada', async () => {
    const { s, crm } = monta({ associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }] });
    const r = await s.rodada(SABADO);
    expect(crm.buscarPorCpf).not.toHaveBeenCalled();
    expect(r.associados).toBe(0);
  });

  it('na segunda pergunta ao CRM por cada associado que ja usou o app', async () => {
    const { s, crm } = monta({
      associados: [
        { id: 'a1', tenantId: 't1', cpf: '11144477735' },
        { id: 'a2', tenantId: 't1', cpf: '52998224725' },
      ],
    });
    await s.rodada(SEGUNDA);
    expect(crm.buscarPorCpf).toHaveBeenCalledTimes(2);
  });

  it('so busca quem ja entrou no app (lastLoginAt nao nulo)', async () => {
    const { s, prisma } = monta();
    await s.rodada(SEGUNDA);
    expect(prisma.associate.findMany.mock.calls[0][0].where.lastLoginAt).toEqual({ not: null });
  });

  it('grava o boleto e baixa o PDF quando ha link', async () => {
    const { s, prisma, crm } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [{
        nossoNumero: '99', placa: 'RJU0F75', mesReferente: '09/2026', valor: 250.57,
        vencimento: '2026-09-20', status: 'disponivel',
        linhaDigitavel: '23793', linkPdf: 'https://hinova.test/b.pdf',
      }],
    });
    const r = await s.rodada(SEGUNDA);
    expect(prisma.associateBoleto.upsert).toHaveBeenCalledTimes(1);
    expect(crm.baixarPdf).toHaveBeenCalledWith('https://hinova.test/b.pdf');
    expect(prisma.associateBoletoPdf.upsert).toHaveBeenCalledTimes(1);
    expect(r.pdfs).toBe(1);
  });

  it('sem link (SGA fechado) grava valor e vencimento e nao tenta PDF', async () => {
    const { s, prisma, crm } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [{
        nossoNumero: '99', placa: 'RJU0F75', mesReferente: '09/2026', valor: 250.57,
        vencimento: '2026-09-20', status: 'disponivel', linhaDigitavel: null, linkPdf: null,
      }],
    });
    await s.rodada(SEGUNDA);
    expect(prisma.associateBoleto.upsert).toHaveBeenCalledTimes(1);
    expect(crm.baixarPdf).not.toHaveBeenCalled();
  });

  it('avisa uma vez so: boleto ja avisado nao gera push de novo', async () => {
    const { s, push, prisma } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [{
        nossoNumero: '99', placa: 'RJU0F75', mesReferente: '09/2026', valor: 250.57,
        vencimento: '2026-09-20', status: 'disponivel', linhaDigitavel: '1', linkPdf: null,
      }],
    });
    prisma.associateBoleto.upsert.mockResolvedValue({ id: 'b1', avisadoEm: new Date() });
    await s.rodada(SEGUNDA);
    expect(push.avisarBoletoNovo).not.toHaveBeenCalled();
  });

  it('apaga boleto que saiu da lista do CRM (pagou ou passou dos 5 dias)', async () => {
    const { s, prisma } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [],
    });
    await s.rodada(SEGUNDA);
    expect(prisma.associateBoleto.deleteMany).toHaveBeenCalled();
    expect(prisma.associateBoletoPdf.deleteMany).toHaveBeenCalled();
  });

  it('carimba a visita mesmo quando o associado nao tem boleto nenhum', async () => {
    const { s, prisma } = monta({
      associados: [{ id: 'a1', tenantId: 't1', cpf: '11144477735' }],
      doCrm: [],
    });
    await s.rodada(SEGUNDA);
    expect(prisma.associate.update.mock.calls[0][0].data.boletosSincronizadosEm)
      .toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/boletos/boletos-sync.service.spec.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Escrever o robô**

```ts
// backend/src/modules/boletos/boletos-sync.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CrmBoletosClient } from './crm-boletos.client';
import { PushService } from './push.service';
import { dentroDaJanelaDoSga } from './boletos.regras';

@Injectable()
export class BoletosSyncService {
  private readonly logger = new Logger(BoletosSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmBoletosClient,
    private readonly push: PushService,
  ) {}

  /**
   * 8h, 12h e 17h30 de Brasília. O cron dispara todo dia; quem barra sábado,
   * domingo e fora de hora é `dentroDaJanelaDoSga` — uma regra só, num lugar só.
   */
  @Cron('0 0,30 8,12,17 * * *', { timeZone: 'America/Sao_Paulo' })
  async rodadaAgendada(): Promise<void> {
    const agora = new Date();
    const hora = agora.getHours();
    const minuto = agora.getMinutes();
    // 8h00, 12h00 e 17h30 — as outras batidas do cron saem fora.
    const horaValida =
      (hora === 8 && minuto === 0) ||
      (hora === 12 && minuto === 0) ||
      (hora === 17 && minuto === 30);
    if (!horaValida) return;
    const r = await this.rodada(agora);
    this.logger.log(
      `boletos: ${r.associados} associados, ${r.gravados} gravados, ${r.pdfs} PDFs, ${r.apagados} apagados`,
    );
  }

  async rodada(agora: Date = new Date()): Promise<{
    associados: number; gravados: number; pdfs: number; apagados: number;
  }> {
    if (!dentroDaJanelaDoSga(agora)) {
      this.logger.log('fora da janela do SGA (seg–sex 7h–18h): rodada não executada');
      return { associados: 0, gravados: 0, pdfs: 0, apagados: 0 };
    }

    const associados = await this.prisma.associate.findMany({
      where: { deletedAt: null, lastLoginAt: { not: null } },
      select: { id: true, tenantId: true, cpf: true },
    });

    let gravados = 0;
    let pdfs = 0;
    let apagados = 0;
    for (const a of associados) {
      const r = await this.sincronizarAssociado(a);
      gravados += r.gravados;
      pdfs += r.pdfs;
      apagados += r.apagados;
    }
    return { associados: associados.length, gravados, pdfs, apagados };
  }

  /**
   * A carga de UM associado. O robô usa em laço; o primeiro acesso (Task 7B) usa
   * sozinha, para quem instalou o app agora não esperar a próxima batida do cron.
   */
  async sincronizarAssociado(a: {
    id: string; tenantId: string; cpf: string | null;
  }): Promise<{ gravados: number; pdfs: number; apagados: number }> {
    const cpf = String(a.cpf ?? '').replace(/\D/g, '');
    if (!cpf) return { gravados: 0, pdfs: 0, apagados: 0 };

    let gravados = 0;
    let pdfs = 0;
    const doCrm = await this.crm.buscarPorCpf(cpf);

    for (const b of doCrm) {
      const dados = {
        tenantId: a.tenantId,
        associateId: a.id,
        nossoNumero: b.nossoNumero,
        plate: b.placa,
        mesReferente: b.mesReferente,
        valor: b.valor,
        vencimento: b.vencimento,
        status: b.status,
        linhaDigitavel: b.linhaDigitavel,
      };
      const linha = await this.prisma.associateBoleto.upsert({
        where: { tenantId_nossoNumero: { tenantId: a.tenantId, nossoNumero: b.nossoNumero } },
        create: dados,
        update: dados,
      });
      gravados += 1;

      if (b.linkPdf) {
        const buf = await this.crm.baixarPdf(b.linkPdf);
        if (buf) {
          // Chave composta: `nosso_numero` não é único entre tenants — cada
          // cooperativa tem seu convênio bancário e a numeração pode colidir.
          await this.prisma.associateBoletoPdf.upsert({
            where: {
              tenantId_nossoNumero: { tenantId: a.tenantId, nossoNumero: b.nossoNumero },
            },
            create: { nossoNumero: b.nossoNumero, tenantId: a.tenantId, conteudo: buf },
            update: { conteudo: buf, baixadoEm: new Date() },
          });
          await this.prisma.associateBoleto.update({
            where: { id: linha.id },
            data: { pdfBytes: buf.length },
          });
          pdfs += 1;
        }
      }

      // Trava do push: uma vez por boleto, para sempre. Quem manda é a coluna.
      if (!linha.avisadoEm) {
        await this.push.avisarBoletoNovo(linha.id, a.id, a.tenantId, b);
      }
    }

    // Sumiu da lista do CRM = pagou ou passou dos 5 dias. Sai daqui também.
    const vivos = doCrm.map((b) => b.nossoNumero);
    const mortos = await this.prisma.associateBoleto.findMany({
      where: { tenantId: a.tenantId, associateId: a.id, nossoNumero: { notIn: vivos } },
      select: { nossoNumero: true },
    });
    const numeros = mortos.map((m) => m.nossoNumero);
    await this.prisma.associateBoletoPdf.deleteMany({
      where: { tenantId: a.tenantId, nossoNumero: { in: numeros } },
    });
    const apagou = await this.prisma.associateBoleto.deleteMany({
      where: { tenantId: a.tenantId, associateId: a.id, nossoNumero: { in: numeros } },
    });

    // Carimbo da visita: é ele que separa "está em dia" de "ainda não olhei".
    await this.prisma.associate.update({
      where: { id: a.id },
      data: { boletosSincronizadosEm: new Date() },
    });

    return { gravados, pdfs, apagados: apagou.count };
  }
}
```

- [ ] **Step 4: Registrar no módulo**

Em `backend/src/modules/boletos/boletos.module.ts`, acrescentar aos providers:

```ts
import { BoletosSyncService } from './boletos-sync.service';
import { PushService } from './push.service';
// providers: [BoletosService, CrmBoletosClient, AssociateJwtGuard, BoletosSyncService, PushService],
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/modules/boletos/boletos-sync.service.spec.ts`
Expected: PASS — 7 testes. (Depende da Task 8 existir: se `push.service` ainda não existe, faça a Task 8 antes do Step 4.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/boletos/boletos-sync.service.ts backend/src/modules/boletos/boletos-sync.service.spec.ts backend/src/modules/boletos/boletos.module.ts
git commit -m "feat(boletos): robo de carga dentro da janela do SGA, com limpeza do que saiu"
```

---

### Task 8: Rastreamento — push e registro do aparelho

**Files:**
- Create: `backend/src/modules/boletos/push.service.ts`
- Test: `backend/src/modules/boletos/push.service.spec.ts`
- Modify: `backend/src/modules/boletos/boletos.controller.ts`

**Interfaces:**
- Consumes: `PrismaService`, `ConfigService`, `BoletoDoCrm` (Task 5)
- Produces:
  - `class PushService { avisarBoletoNovo(boletoId: string, associateId: string, tenantId: string, b: BoletoDoCrm): Promise<void>; registrarAparelho(associateId: string, tenantId: string, expoToken: string, platform: string): Promise<void>; }`
  - `function textoDoAviso(b: { mesReferente: string | null; valor: number | null; vencimento: string | null }): string`
  - `POST /app/boletos/dispositivo`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/modules/boletos/push.service.spec.ts
import { PushService, textoDoAviso } from './push.service';

describe('textoDoAviso', () => {
  it('diz o mes, o valor e o dia — na lingua do dono do carro', () => {
    expect(
      textoDoAviso({ mesReferente: '09/2026', valor: 250.57, vencimento: '2026-09-20' }),
    ).toBe('Seu boleto de setembro já está disponível — R$ 250,57, vence dia 20.');
  });

  it('sem valor nao inventa numero', () => {
    expect(
      textoDoAviso({ mesReferente: '09/2026', valor: null, vencimento: '2026-09-20' }),
    ).toBe('Seu boleto de setembro já está disponível.');
  });
});

function monta(tokens: any[] = [{ expoToken: 'ExponentPushToken[x]' }]) {
  const prisma = {
    associatePushDevice: {
      findMany: jest.fn().mockResolvedValue(tokens),
      upsert: jest.fn().mockResolvedValue({}),
    },
    associateBoleto: { update: jest.fn().mockResolvedValue({}) },
  } as any;
  const config = {
    get: (k: string) =>
      ({ 'expoPush.url': 'https://exp.test/send', 'expoPush.enabled': true })[k],
  } as any;
  const envio = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  return { s: new PushService(prisma, config, envio as unknown as typeof fetch), prisma, envio };
}

const BOLETO = { mesReferente: '09/2026', valor: 250.57, vencimento: '2026-09-20' } as any;

describe('PushService.avisarBoletoNovo', () => {
  it('envia e carimba avisadoEm no mesmo passo', async () => {
    const { s, prisma, envio } = monta();
    await s.avisarBoletoNovo('b1', 'a1', 't1', BOLETO);
    expect(envio).toHaveBeenCalledTimes(1);
    expect(prisma.associateBoleto.update.mock.calls[0][0].data.avisadoEm).toBeInstanceOf(Date);
  });

  it('associado sem aparelho registrado nao dispara nada', async () => {
    const { s, envio } = monta([]);
    await s.avisarBoletoNovo('b1', 'a1', 't1', BOLETO);
    expect(envio).not.toHaveBeenCalled();
  });

  it('falha no envio NAO carimba avisadoEm — senao o associado nunca recebe', async () => {
    const prisma = {
      associatePushDevice: { findMany: jest.fn().mockResolvedValue([{ expoToken: 'T' }]) },
      associateBoleto: { update: jest.fn() },
    } as any;
    const config = { get: () => true } as any;
    const envio = jest.fn().mockRejectedValue(new Error('rede caiu'));
    const s = new PushService(prisma, config, envio as unknown as typeof fetch);
    await s.avisarBoletoNovo('b1', 'a1', 't1', BOLETO);
    expect(prisma.associateBoleto.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/boletos/push.service.spec.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Escrever o service**

```ts
// backend/src/modules/boletos/push.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** A frase do push. Sem jargão, sem "mensalidade referente a competência". */
export function textoDoAviso(b: {
  mesReferente: string | null;
  valor: number | null;
  vencimento: string | null;
}): string {
  const mesNumero = Number(String(b.mesReferente ?? '').slice(0, 2));
  const mes = MESES[mesNumero - 1];
  const deQualMes = mes ? ` de ${mes}` : '';
  if (b.valor == null) return `Seu boleto${deQualMes} já está disponível.`;
  const valor = b.valor.toFixed(2).replace('.', ',');
  const dia = String(b.vencimento ?? '').slice(8, 10);
  const quando = dia ? `, vence dia ${Number(dia)}` : '';
  return `Seu boleto${deQualMes} já está disponível — R$ ${valor}${quando}.`;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly enviar: typeof fetch = fetch,
  ) {}

  async registrarAparelho(
    associateId: string,
    tenantId: string,
    expoToken: string,
    platform: string,
  ): Promise<void> {
    await this.prisma.associatePushDevice.upsert({
      where: { expoToken },
      create: { associateId, tenantId, expoToken, platform },
      update: { associateId, tenantId, platform },
    });
  }

  /**
   * Um aviso por boleto, para sempre. O carimbo só cai DEPOIS do envio dar certo:
   * carimbar antes transformaria uma falha de rede em associado que nunca soube.
   */
  async avisarBoletoNovo(
    boletoId: string,
    associateId: string,
    tenantId: string,
    b: { mesReferente: string | null; valor: number | null; vencimento: string | null },
  ): Promise<void> {
    const aparelhos = await this.prisma.associatePushDevice.findMany({
      where: { associateId, tenantId },
      select: { expoToken: true },
    });
    if (!aparelhos.length) return;

    const url = this.config.get<string>('expoPush.url') ?? 'https://exp.host/--/api/v2/push/send';
    const mensagens = aparelhos.map((a) => ({
      to: a.expoToken,
      title: '21 Tracker',
      body: textoDoAviso(b),
      data: { rota: '/boletos' },
    }));

    try {
      await this.enviar(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mensagens),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.logger.warn(`push não saiu: ${(err as Error).message}`);
      return;
    }

    await this.prisma.associateBoleto.update({
      where: { id: boletoId },
      data: { avisadoEm: new Date() },
    });
  }
}
```

- [ ] **Step 4: Acrescentar a rota de registro do aparelho**

Em `backend/src/modules/boletos/boletos.controller.ts`, acrescentar o import e o método:

```ts
import { Body, Post } from '@nestjs/common';
import { PushService } from './push.service';

// no constructor:
//   constructor(private readonly service: BoletosService, private readonly push: PushService) {}

  @Post('dispositivo')
  @ApiOperation({ summary: 'Registra o aparelho do associado para receber push' })
  async registrarDispositivo(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
    @Body() body: { expoToken: string; platform: string },
  ) {
    await this.push.registrarAparelho(associateId, tenantId, body.expoToken, body.platform);
    return { ok: true };
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/modules/boletos && npx tsc --noEmit -p tsconfig.json`
Expected: PASS em todos os specs do módulo, zero erro de tipo

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/boletos/push.service.ts backend/src/modules/boletos/push.service.spec.ts backend/src/modules/boletos/boletos.controller.ts
git commit -m "feat(boletos): push do boleto disponivel, uma vez por boleto"
```

---

### Task 7B: Rastreamento — primeiro acesso de quem o robô ainda não visitou

> Executar **depois** da Task 7. Fecha o caso do spec: "quem nunca abriu o app não tem boleto
> guardado". A carga de um associado só (`sincronizarAssociado`) já existe desde a Task 7 —
> aqui ela é ligada ao primeiro acesso.

**Files:**
- Modify: `backend/src/modules/boletos/boletos.controller.ts`
- Modify: `backend/src/modules/boletos/boletos.service.ts`
- Test: `backend/src/modules/boletos/boletos-primeiro-acesso.spec.ts`

**Interfaces:**
- Consumes: `BoletosSyncService.sincronizarAssociado` (Task 7); `dentroDaJanelaDoSga` (Task 4)
- Produces: `BoletosService.dadosParaSincronizar(associateId: string, tenantId: string): Promise<{ id: string; tenantId: string; cpf: string | null } | null>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/modules/boletos/boletos-primeiro-acesso.spec.ts
import { BoletosController } from './boletos.controller';

const SEGUNDA_9H = new Date('2026-09-14T09:00:00-03:00');
const SABADO_MEIO_DIA = new Date('2026-09-12T12:00:00-03:00');

function monta(pendente: boolean) {
  const service = {
    listarDoAssociado: jest.fn().mockResolvedValue({ boletos: [], pendente, rodape: {} }),
    dadosParaSincronizar: jest
      .fn()
      .mockResolvedValue({ id: 'a1', tenantId: 't1', cpf: '11144477735' }),
  } as any;
  const sync = { sincronizarAssociado: jest.fn().mockResolvedValue({}) } as any;
  const push = {} as any;
  return { c: new BoletosController(service, push, sync), service, sync };
}

describe('GET /app/boletos — primeiro acesso', () => {
  afterEach(() => jest.useRealTimers());

  it('nunca visitado E SGA aberto: carrega na hora e devolve a lista recarregada', async () => {
    jest.useFakeTimers().setSystemTime(SEGUNDA_9H);
    const { c, service, sync } = monta(true);
    await c.listar('a1', 't1');
    expect(sync.sincronizarAssociado).toHaveBeenCalledTimes(1);
    expect(service.listarDoAssociado).toHaveBeenCalledTimes(2);
  });

  it('nunca visitado mas SGA fechado (sabado): NAO tenta carregar', async () => {
    jest.useFakeTimers().setSystemTime(SABADO_MEIO_DIA);
    const { c, sync } = monta(true);
    await c.listar('a1', 't1');
    expect(sync.sincronizarAssociado).not.toHaveBeenCalled();
  });

  it('ja visitado: nao carrega de novo, mesmo dentro da janela', async () => {
    jest.useFakeTimers().setSystemTime(SEGUNDA_9H);
    const { c, sync, service } = monta(false);
    await c.listar('a1', 't1');
    expect(sync.sincronizarAssociado).not.toHaveBeenCalled();
    expect(service.listarDoAssociado).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/boletos/boletos-primeiro-acesso.spec.ts`
Expected: FAIL — o controller ainda tem 2 parâmetros no constructor e não chama o sync

- [ ] **Step 3: Ligar no controller**

Em `boletos.controller.ts`, acrescentar os imports, o terceiro parâmetro do constructor e a
lógica no `listar`:

```ts
import { dentroDaJanelaDoSga } from './boletos.regras';
import { BoletosSyncService } from './boletos-sync.service';

  constructor(
    private readonly service: BoletosService,
    private readonly push: PushService,
    private readonly sync: BoletosSyncService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Boletos em aberto de todos os veículos do associado' })
  async listar(
    @CurrentAssociate('id') associateId: string,
    @CurrentAssociate('tenantId') tenantId: string,
  ) {
    const primeira = await this.service.listarDoAssociado(associateId, tenantId);
    // Nunca visitado E o SGA está aberto: carrega agora, em vez de mandar o
    // associado esperar até segunda por um boleto que dá para buscar já.
    if (primeira.pendente && dentroDaJanelaDoSga(new Date())) {
      const a = await this.service.dadosParaSincronizar(associateId, tenantId);
      if (a) {
        await this.sync.sincronizarAssociado(a);
        return this.service.listarDoAssociado(associateId, tenantId);
      }
    }
    return primeira;
  }
```

E em `boletos.service.ts`:

```ts
  /** Só o que a carga precisa. Não devolve nada além disto. */
  async dadosParaSincronizar(
    associateId: string,
    tenantId: string,
  ): Promise<{ id: string; tenantId: string; cpf: string | null } | null> {
    const a = await this.prisma.associate.findFirst({
      where: { id: associateId, tenantId, deletedAt: null },
      select: { id: true, tenantId: true, cpf: true },
    });
    return a ?? null;
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/boletos && npx tsc --noEmit -p tsconfig.json`
Expected: PASS em tudo, zero erro de tipo

- [ ] **Step 5: Commit**

Comitar os três arquivos, um a um, com a mensagem:
`feat(boletos): primeiro acesso carrega na hora quando o SGA esta aberto`

---


### Task 9: App — regras da tela (puro)

**Files:**
- Create: `mobile/src/lib/boletos.ts`
- Test: `mobile/src/lib/boletos.test.ts`

**Interfaces:**
- Produces:
  - `type Boleto = { id: string; placa: string | null; mesReferente: string | null; valor: number | null; vencimento: string | null; rotulo: string; linhaDigitavel: string | null; temPdf: boolean }`
  - `function valorEmReais(valor: number | null): string`
  - `function estaVencido(rotulo: string): boolean`
  - `function tituloDoBoleto(mesReferente: string | null): string`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// mobile/src/lib/boletos.test.ts
import { estaVencido, tituloDoBoleto, valorEmReais } from './boletos';

describe('valorEmReais', () => {
  it('formata no padrao brasileiro', () => {
    expect(valorEmReais(250.57)).toBe('R$ 250,57');
  });
  it('milhar com ponto', () => {
    expect(valorEmReais(1250.5)).toBe('R$ 1.250,50');
  });
  it('sem valor mostra traco, nunca R$ 0,00', () => {
    expect(valorEmReais(null)).toBe('—');
  });
});

describe('estaVencido — decide a cor do cartao', () => {
  it('venceu ontem esta vencido', () => {
    expect(estaVencido('venceu ontem')).toBe(true);
  });
  it('venceu ha 3 dias esta vencido', () => {
    expect(estaVencido('venceu há 3 dias')).toBe(true);
  });
  it('vence hoje ainda NAO esta vencido', () => {
    expect(estaVencido('vence hoje')).toBe(false);
  });
  it('vence em 8 dias nao esta vencido', () => {
    expect(estaVencido('vence em 8 dias')).toBe(false);
  });
});

describe('tituloDoBoleto', () => {
  it('escreve o mes por extenso', () => {
    expect(tituloDoBoleto('09/2026')).toBe('Mensalidade de setembro');
  });
  it('sem mes usa titulo generico', () => {
    expect(tituloDoBoleto(null)).toBe('Mensalidade');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "C:\Users\damas\Documents\PROJETOS\21 GO\21 - RASTREAMENTO\mobile" && npx jest src/lib/boletos.test.ts`
Expected: FAIL — `Cannot find module './boletos'`

- [ ] **Step 3: Escrever a implementação**

```ts
// mobile/src/lib/boletos.ts

export type Boleto = {
  id: string;
  placa: string | null;
  mesReferente: string | null;
  valor: number | null;
  vencimento: string | null;
  rotulo: string;
  linhaDigitavel: string | null;
  temPdf: boolean;
};

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function valorEmReais(valor: number | null): string {
  if (valor == null) return '—';
  const [inteiro, centavos] = valor.toFixed(2).split('.');
  const comPonto = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${comPonto},${centavos}`;
}

/** A cor do cartão sai do rótulo que o backend escreveu — uma regra só, no servidor. */
export function estaVencido(rotulo: string): boolean {
  return rotulo.startsWith('venceu');
}

export function tituloDoBoleto(mesReferente: string | null): string {
  const mes = MESES[Number(String(mesReferente ?? '').slice(0, 2)) - 1];
  return mes ? `Mensalidade de ${mes}` : 'Mensalidade';
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/lib/boletos.test.ts`
Expected: PASS — 9 testes

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\damas\Documents\PROJETOS\21 GO\21 - RASTREAMENTO"
git add mobile/src/lib/boletos.ts mobile/src/lib/boletos.test.ts
git commit -m "feat(app): regras de exibicao do boleto na aba"
```

---

### Task 10: App — a aba e a tela

**Files:**
- Modify: `mobile/src/lib/api.ts`
- Create: `mobile/src/app/(tabs)/boletos.tsx`
- Modify: `mobile/src/app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `Boleto`, `valorEmReais`, `estaVencido`, `tituloDoBoleto` (Task 9); `api`, `colors`, `radii`
- Produces: `AppApi.boletos(): Promise<{ boletos: Boleto[]; rodape: { titulo: string; telefones: string } }>`; `AppApi.pdfUrl(id: string): string`; `AppApi.registrarPush(expoToken: string, platform: string)`

- [ ] **Step 1: Acrescentar os métodos na API do app**

Em `mobile/src/lib/api.ts`, dentro do objeto `AppApi`:

```ts
  /** Boletos em aberto de todos os veículos. Lê o espelho local do backend. */
  boletos: () =>
    api
      .get<{
        boletos: import('./boletos').Boleto[];
        /** true = o robô ainda não visitou este associado. Não é o mesmo que estar em dia. */
        pendente: boolean;
        rodape: { titulo: string; telefones: string };
      }>('/app/boletos')
      .then((r) => r.data),

  /** URL do PDF guardado. O token vai no header pelo interceptor do axios. */
  pdfUrl: (id: string) => `${api.defaults.baseURL}/app/boletos/${id}/pdf`,

  registrarPush: (expoToken: string, platform: string) =>
    api
      .post<{ ok: boolean }>('/app/boletos/dispositivo', { expoToken, platform })
      .then((r) => r.data),
```

- [ ] **Step 2: Escrever a tela**

```tsx
// mobile/src/app/(tabs)/boletos.tsx
import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, RefreshControl, Linking, Alert as RNAlert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { AppApi } from '@/lib/api';
import { Boleto, estaVencido, tituloDoBoleto, valorEmReais } from '@/lib/boletos';
import { colors, radii } from '@/lib/theme';

export default function BoletosScreen() {
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [pendente, setPendente] = useState(false);
  const [rodape, setRodape] = useState({ titulo: '', telefones: '' });
  const [loading, setLoading] = useState(true);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(() => {
    return AppApi.boletos()
      .then((r) => {
        setBoletos(r.boletos);
        setPendente(r.pendente);
        setRodape(r.rodape);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setAtualizando(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar]),
  );

  async function copiar(boleto: Boleto) {
    if (!boleto.linhaDigitavel) return;
    await Clipboard.setStringAsync(boleto.linhaDigitavel);
    RNAlert.alert('Copiado', 'Código do boleto copiado. Cole no app do seu banco para pagar.');
  }

  function baixar(boleto: Boleto) {
    Linking.openURL(AppApi.pdfUrl(boleto.id)).catch(() => {
      RNAlert.alert('Não deu para abrir', 'Tente de novo em instantes.');
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Text style={styles.title}>Boletos</Text>

      {loading ? (
        <ActivityIndicator color={colors.navy} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.lista}
          refreshControl={
            <RefreshControl
              refreshing={atualizando}
              onRefresh={() => {
                setAtualizando(true);
                carregar();
              }}
              tintColor={colors.navy}
            />
          }
        >
          {boletos.length === 0 && pendente ? (
            // Nunca dizer "em dia" a quem ainda não foi conferido.
            <View style={styles.vazio}>
              <Ionicons name="time-outline" size={44} color={colors.textFaint} />
              <Text style={styles.vazioTitulo}>Estamos buscando seus boletos</Text>
              <Text style={styles.vazioTexto}>
                Eles aparecem aqui a partir da próxima segunda-feira.
              </Text>
            </View>
          ) : boletos.length === 0 ? (
            <View style={styles.vazio}>
              <Ionicons name="checkmark-circle" size={44} color={colors.navy} />
              <Text style={styles.vazioTitulo}>Você está em dia</Text>
              <Text style={styles.vazioTexto}>Nenhum boleto em aberto.</Text>
            </View>
          ) : (
            boletos.map((b) => {
              const vencido = estaVencido(b.rotulo);
              return (
                <View key={b.id} style={styles.card}>
                  <Text style={styles.placa}>{b.placa ?? 'Veículo'}</Text>
                  <Text style={styles.mes}>{tituloDoBoleto(b.mesReferente)}</Text>

                  <View style={styles.linhaValor}>
                    <Text style={styles.valor}>{valorEmReais(b.valor)}</Text>
                    <Text style={[styles.rotulo, vencido && styles.rotuloVencido]}>
                      {b.rotulo}
                    </Text>
                  </View>

                  <View style={styles.botoes}>
                    <TouchableOpacity
                      style={[styles.botao, !b.linhaDigitavel && styles.botaoDesligado]}
                      disabled={!b.linhaDigitavel}
                      onPress={() => copiar(b)}
                    >
                      <Ionicons name="copy-outline" size={16} color={colors.navy} />
                      <Text style={styles.botaoTexto}>Copiar código</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.botao, styles.botaoCheio, !b.temPdf && styles.botaoDesligado]}
                      disabled={!b.temPdf}
                      onPress={() => baixar(b)}
                    >
                      <Ionicons name="download-outline" size={16} color={colors.white} />
                      <Text style={[styles.botaoTexto, styles.botaoTextoCheio]}>Baixar boleto</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          <View style={styles.rodape}>
            <Text style={styles.rodapeTitulo}>{rodape.titulo}</Text>
            <Text style={styles.rodapeTelefones}>{rodape.telefones}</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  title: { fontSize: 24, fontWeight: '700', color: colors.navy, padding: 20, paddingBottom: 8 },
  lista: { padding: 16, paddingTop: 4, gap: 12 },
  card: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg,
    padding: 16, backgroundColor: colors.white, gap: 4,
  },
  placa: { fontSize: 15, fontWeight: '700', color: colors.navy },
  mes: { fontSize: 13, color: colors.textFaint },
  linhaValor: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-end', marginTop: 8,
  },
  valor: { fontSize: 22, fontWeight: '700', color: colors.navy },
  rotulo: { fontSize: 13, color: colors.textFaint },
  rotuloVencido: { color: colors.red, fontWeight: '700' },
  botoes: { flexDirection: 'row', gap: 8, marginTop: 14 },
  botao: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.navy,
  },
  botaoCheio: { backgroundColor: colors.navy },
  botaoDesligado: { opacity: 0.4 },
  botaoTexto: { fontSize: 13, fontWeight: '600', color: colors.navy },
  botaoTextoCheio: { color: colors.white },
  vazio: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  vazioTitulo: { fontSize: 17, fontWeight: '700', color: colors.navy },
  vazioTexto: { fontSize: 14, color: colors.textFaint },
  rodape: { marginTop: 24, paddingHorizontal: 4, gap: 4 },
  rodapeTitulo: { fontSize: 13, color: colors.textFaint, textAlign: 'center' },
  rodapeTelefones: {
    fontSize: 14, fontWeight: '700', color: colors.navy, textAlign: 'center',
  },
});
```

- [ ] **Step 3: Pôr a aba no lugar certo**

Em `mobile/src/app/(tabs)/_layout.tsx`, **entre** `trips` e `profile`:

```tsx
      <Tabs.Screen
        name="boletos"
        options={{
          title: 'Boletos',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text" size={size} color={color} />
          ),
        }}
      />
```

- [ ] **Step 4: Instalar a dependência do copiar**

Run: `cd mobile && npx expo install expo-clipboard`
Expected: `expo-clipboard` no `package.json`, versão compatível com SDK 54

- [ ] **Step 5: Conferir tipos e a suíte inteira do app**

Run: `npx tsc --noEmit && npx jest && npm run test:mapa`
Expected: zero erro de tipo, testes verdes. O `test:mapa` é regra do projeto: toda mexida no app termina com ele verde, mesmo quando a mudança não toca no mapa.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\damas\Documents\PROJETOS\21 GO\21 - RASTREAMENTO"
git add mobile/src/app/\(tabs\)/boletos.tsx mobile/src/app/\(tabs\)/_layout.tsx mobile/src/lib/api.ts mobile/package.json mobile/package-lock.json
git commit -m "feat(app): aba Boletos com copiar codigo e baixar PDF"
```

---

### Task 11: App — a notificação

**Files:**
- Create: `mobile/src/lib/push.ts`
- Test: `mobile/src/lib/push.test.ts`
- Modify: `mobile/src/app/_layout.tsx`
- Modify: `mobile/app.json`

**Interfaces:**
- Consumes: `AppApi.registrarPush` (Task 10)
- Produces: `function rotaDoAviso(data: unknown): string | null`; `async function registrarParaPush(): Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// mobile/src/lib/push.test.ts
import { rotaDoAviso } from './push';

describe('rotaDoAviso — para onde o toque leva', () => {
  it('aviso de boleto abre a aba de boletos', () => {
    expect(rotaDoAviso({ rota: '/boletos' })).toBe('/boletos');
  });
  it('payload sem rota nao navega', () => {
    expect(rotaDoAviso({})).toBeNull();
  });
  it('rota estranha e ignorada — push nao manda o app pra qualquer lugar', () => {
    expect(rotaDoAviso({ rota: 'https://site-suspeito.test' })).toBeNull();
  });
  it('lixo nao quebra', () => {
    expect(rotaDoAviso(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd mobile && npx jest src/lib/push.test.ts`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Escrever o módulo**

```ts
// mobile/src/lib/push.ts
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { AppApi } from './api';

/** Só estas rotas podem vir num push. Qualquer outra coisa é ignorada. */
const ROTAS_PERMITIDAS = ['/boletos'];

export function rotaDoAviso(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const rota = (data as { rota?: unknown }).rota;
  return typeof rota === 'string' && ROTAS_PERMITIDAS.includes(rota) ? rota : null;
}

/**
 * Pede a permissão e registra o aparelho. Recusa não é erro: o associado
 * continua vendo o boleto ao abrir a aba.
 */
export async function registrarParaPush(): Promise<void> {
  try {
    const atual = await Notifications.getPermissionsAsync();
    const permissao = atual.granted
      ? atual
      : await Notifications.requestPermissionsAsync();
    if (!permissao.granted) return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await AppApi.registrarPush(token.data, Platform.OS);
  } catch {
    // Sem push o app segue inteiro. Nunca derrubar o boot por causa disso.
  }
}
```

- [ ] **Step 4: Instalar e ligar no boot do app**

Run: `npx expo install expo-notifications`

Em `mobile/src/app/_layout.tsx`, dentro do componente raiz, depois que a sessão do associado está carregada:

```tsx
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { registrarParaPush, rotaDoAviso } from '@/lib/push';

// dentro do componente:
  const router = useRouter();
  useEffect(() => {
    registrarParaPush();
    const sub = Notifications.addNotificationResponseReceivedListener((resposta) => {
      const rota = rotaDoAviso(resposta.notification.request.content.data);
      if (rota) router.push(rota as never);
    });
    return () => sub.remove();
  }, [router]);
```

- [ ] **Step 5: Declarar o plugin e subir a versão**

Em `mobile/app.json`, dentro de `expo.plugins`:

```json
      ["expo-notifications", { "icon": "./assets/images/icon.png", "color": "#293c82" }]
```

E subir `expo.version` de `1.5.0` para `1.6.0`. **Não mexer em `newArchEnabled`.**

- [ ] **Step 6: Rodar os testes**

Run: `npx jest src/lib && npx tsc --noEmit`
Expected: PASS, zero erro de tipo

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\damas\Documents\PROJETOS\21 GO\21 - RASTREAMENTO"
git add mobile/src/lib/push.ts mobile/src/lib/push.test.ts mobile/src/app/_layout.tsx mobile/app.json mobile/package.json mobile/package-lock.json
git commit -m "feat(app): push do boleto disponivel abrindo a aba Boletos"
```

---

### Task 12: Provar a linha digitável contra o SGA de verdade

> ⚠️ **Só pode rodar seg–sex, entre 7h e 18h de Brasília.** Fora disso a credencial responde 401 e o teste não prova nada. Confira a hora com `date '+%H:%M'` — nunca com `TZ=America/Sao_Paulo date`, que no Git Bash do Windows devolve GMT.

**Files:**
- Create: `backend/scripts/provar-linha-digitavel.mjs` (script de investigação, descartável)

- [ ] **Step 1: Escrever o script**

```js
// backend/scripts/provar-linha-digitavel.mjs
// Pergunta ao SGA um boleto em aberto e mostra QUAIS campos vêm. Só leitura.
const base = process.env.HINOVA_SGA_BASE_URL;
const auth = await fetch(`${base}/usuario/autenticar`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.HINOVA_SGA_TOKEN}` },
  body: JSON.stringify({ usuario: process.env.HINOVA_SGA_USUARIO, senha: process.env.HINOVA_SGA_SENHA }),
});
const a = await auth.json();
if (!a.token_usuario) { console.log('SGA recusou:', JSON.stringify(a)); process.exit(1); }

const placa = process.argv[2];
const r = await fetch(`${base}/listar/boleto-associado-veiculo`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.token_usuario}` },
  body: JSON.stringify({ placa }),
});
const j = await r.json();
const lista = j.boletos ?? j;
const primeiro = Array.isArray(lista) ? lista[0] : lista;
console.log('CAMPOS:', Object.keys(primeiro ?? {}).join(', '));
console.log('tem linha_digitavel?', 'linha_digitavel' in (primeiro ?? {}));
console.log('tem link_boleto?', 'link_boleto' in (primeiro ?? {}));
```

- [ ] **Step 2: Rodar contra produção, em horário comercial**

```bash
CID=$(ssh -i ~/.ssh/claude_21go root@167.71.31.77 "docker ps -q -f name=backend-rastreamento | head -1")
ssh -i ~/.ssh/claude_21go root@167.71.31.77 "cat > /tmp/p.mjs && docker cp /tmp/p.mjs $CID:/tmp/p.mjs && docker exec $CID node /tmp/p.mjs TUL1B79" < backend/scripts/provar-linha-digitavel.mjs
```

Expected: lista de campos. **Se `linha_digitavel` aparecer**, nada muda. **Se não aparecer**, a rota do CRM (Task 2) já cobre o caso — ela pergunta boleto a boleto por `buscarBoletoPorNumero`, que traz o campo; anote o resultado no spec e siga.

- [ ] **Step 3: Registrar o que foi medido**

Acrescentar ao spec, na seção "Riscos e pendências", a linha com a data, a placa usada e os campos que voltaram. Trocar o ⚠️ da linha digitável por fato medido.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/provar-linha-digitavel.mjs docs/superpowers/specs/2026-09-12-boletos-no-app-design.md
git commit -m "test(boletos): prova de quais campos o SGA devolve na listagem por placa"
```

---

### Task 13: Deploy do backend e do CRM

> ⚠️ Regra 0 do projeto. Avise as outras sessões antes de buildar: **dois builds simultâneos no droplet já derrubaram container por OOM**. Nunca buildar backend e frontend em paralelo.

- [ ] **Step 1: Baseline antes de tocar em qualquer coisa**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.trackgo.site/api/v1/health
curl -s -o /dev/null -w "%{http_code}\n" https://trackgo.site
ssh -i ~/.ssh/claude_21go root@167.71.31.77 "df -h / | tail -1"
```
Expected: 200, 200, disco abaixo de 80%

- [ ] **Step 2: Aplicar a migration em produção, sozinha**

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 \
  "docker exec -i rastreamento-21-go_postgres-rastreamento.1.jve8bslrjpsj3lt9xz9e8alg2 \
   psql -U postgres -d rastreamento21go" < backend/prisma/migrations/20260913090000_boletos_do_associado/migration.sql
```
Expected: `CREATE TABLE` / `CREATE INDEX` sem erro. A DDL é toda `IF NOT EXISTS` — rodar duas vezes não quebra.

- [ ] **Step 3: Pôr as variáveis novas no serviço**

No EasyPanel, no serviço `backend-rastreamento`: `CRM_API_URL`, `CRM_INTEGRACAO_TOKEN`, `EXPO_PUSH_ENABLED=true`. No CRM (`social-21go_crm-21go`): `INTEGRACAO_TOKEN` com **o mesmo valor**. Gere o segredo com `openssl rand -hex 32` e **nunca** o escreva em commit, log ou nota.

- [ ] **Step 3B: Deploy do CRM (a rota de integração vive lá)**

> ⚠️ O CRM da 21Go roda em **Lightsail próprio** — `56.126.48.234`, usuário `ubuntu`, código em
> `/opt/crm21go` — e **não** no droplet da DigitalOcean. No droplet existe um container
> `social-21go_crm-21go` do mesmo código ainda rodando cron (é dele que saem as recusas do SGA
> medidas em 12/09). **Antes de deployar, descubra qual dos dois atende o `CRM_API_URL` que você
> vai configurar** — o backend do rastreamento precisa apontar para a instância que realmente
> serve a rota nova.

O procedimento é o documentado no `CLAUDE.md` do CRM, e duas flags não são opcionais:

```bash
ssh -i ~/.ssh/claude_21go ubuntu@56.126.48.234
cd /opt/crm21go && git fetch origin main && git reset --hard origin/main
sudo docker build --cpuset-cpus="0,1" -t crm21go:latest .
sudo docker rm -f crm
sudo docker run -d --name crm --restart unless-stopped \
  -e TZ=America/Sao_Paulo \
  --env-file /opt/crm21go/.env.producao -e PORT=3333 -e NODE_ENV=production \
  -p 127.0.0.1:3333:3333 crm21go:latest
```

- **`--cpuset-cpus="0,1"`**: sem ele o build toma os 4 vCPUs, as rotas vão de 85 ms a 12 s e o
  Caddy responde 502 aos consultores. Medido em 13/08/2026: 26 builds = 774 respostas 502.
- **`TZ=America/Sao_Paulo`**: sem ele o container roda em UTC e, das 21h à meia-noite, o boleto
  ganha um dia de atraso que não existe. Conferir com `docker exec crm date` — tem que terminar
  em `-03`.

Verificação obrigatória depois, sem presumir:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<host-do-crm>/api/health
curl -s -H "Authorization: Bearer $INTEGRACAO_TOKEN" \
  "https://<host-do-crm>/api/integracao/boletos?cpf=<cpf de teste>" | head -c 300
curl -s -o /dev/null -w "%{http_code}\n" "https://<host-do-crm>/api/integracao/boletos?cpf=00000000000"
```
Expected: health 200; a consulta com segredo devolve `{"boletos":[...]}`; **sem** o header,
`401`. A terceira chamada é a que prova que a porta não ficou aberta.

- [ ] **Step 4: Buildar e publicar o backend**

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 "cd /opt/rastreamento && git pull && \
  docker build -t localhost:5000/rastreamento-backend:boletos -f backend/Dockerfile backend && \
  docker push localhost:5000/rastreamento-backend:boletos && \
  docker service update --image localhost:5000/rastreamento-backend:boletos \
    rastreamento-21-go_backend-rastreamento"
```
Expected: `verify: Service converged`. Swarm puxa do registry — build sozinho não troca a task.

- [ ] **Step 5: Verificar de verdade, sem presumir**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.trackgo.site/api/v1/health
ssh -i ~/.ssh/claude_21go root@167.71.31.77 "docker service ps rastreamento-21-go_backend-rastreamento --no-trunc | head -3"
ssh -i ~/.ssh/claude_21go root@167.71.31.77 "docker logs --tail 40 \$(docker ps -q -f name=backend-rastreamento|head -1) | grep -i 'boleto\|error' | head"
```
Expected: 200, réplica 1/1 `Running`, nenhum erro de boot. ⚠️ O `gitSha` do `/health` **mente** (é fixo no spec do Swarm): confirme pelo `builtAt` ou por um `grep` de texto novo dentro do container.

- [ ] **Step 6: Forçar uma rodada e conferir que gravou**

Em horário comercial, com o container no ar:

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 "docker exec rastreamento-21-go_postgres-rastreamento.1.jve8bslrjpsj3lt9xz9e8alg2 \
  psql -U postgres -d rastreamento21go -c \
  \"select count(*) boletos, count(pdf_bytes) com_pdf, pg_size_pretty(sum(pdf_bytes)::bigint) tamanho from associate_boletos;\""
```
Expected: contagem maior que zero depois da primeira rodada das 8h/12h/17h30.

- [ ] **Step 7: Commit do que mudou em arquivo**

```bash
git add docs/superpowers/plans/2026-09-12-boletos-no-app.md
git commit -m "docs(boletos): registra o deploy da aba no backend"
```

---

### Task 14: Build do app e envio às lojas

- [ ] **Step 1: Conferir credencial de push nas duas plataformas**

Run: `cd mobile && npx eas credentials`
Expected: FCM (Android) e APNs key (iOS) presentes no perfil de produção. Se faltar, configurar antes de buildar — build sem credencial sobe e o push simplesmente não chega.

- [ ] **Step 2: Build**

Run: `npx eas build --platform all --profile production`
Expected: dois artefatos. ⚠️ Se a cota do EAS estiver esgotada, use o caminho do GitHub Actions (`macos-15` + Xcode 26 + `eas build --local`) já documentado no projeto.

- [ ] **Step 3: Provar no aparelho antes de submeter**

Checklist manual, na ordem:
1. abrir o app → a aba **Boletos** aparece entre Trajetos e Perfil;
2. associado com boleto em aberto → o cartão mostra placa, mês, valor e o rótulo certo;
3. **Copiar código** → colar no app do banco e ver o boleto certo;
4. **Baixar boleto** → o PDF abre;
5. associado em dia → "Você está em dia" mais os telefones do Setor de Boletos;
6. **repetir tudo num sábado** — é o teste que prova o desenho inteiro.

- [ ] **Step 4: Submeter**

Run: `npx eas submit --platform all --profile production`
Expected: aceitos para revisão. A Apple leva 1–2 dias; **não anunciar a aba antes de estar aprovada e disponível nas lojas**.

- [ ] **Step 5: Commit da versão**

```bash
git add mobile/app.json
git commit -m "chore(app): versao 1.6.0 com a aba Boletos"
```

---

## Ordem e dependências

```
Task 1 → Task 2                     (CRM: regras → rota)
Task 3 → Task 4 → Task 5            (rastreamento: tabelas → regras → cliente)
Task 5 + Task 3 → Task 6            (leitura da aba)
Task 8 → Task 7 → Task 7B           (push, depois o robô, depois a carga sob demanda)
Task 9 → Task 10 → Task 11          (app)
Task 2 + Task 7B → Task 13          (deploy do backend, com o CRM já no ar)
Task 11 + Task 13 → Task 14         (lojas)
Task 12 é independente, mas só roda seg–sex 7h–18h
```

**Ordem de execução sugerida:** 1, 2, 3, 4, 5, 6, 8, 7, 7B, 9, 10, 11, 12, 13, 14.

## O que este plano NÃO faz

Pagamento dentro do app, Pix, segunda via gerada pelo app, negociação de dívida, histórico de boletos pagos, boleto de quem não usa o app, badge na aba, e disparo por WhatsApp (esse continua no CRM, como já está).
