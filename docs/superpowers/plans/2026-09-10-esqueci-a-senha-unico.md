# Esqueci a senha — um botão só, para todo mundo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um botão "Esqueci a senha" no site, no PWA do técnico e no app, todos usando o mesmo código de 6 dígitos enviado no WhatsApp oficial 5046.

**Architecture:** O motor de recuperação que já roda em produção no app do associado sai de `AssociateAuthService` e vira `PasswordResetService`, um serviço genérico que trabalha sobre um *port* (`RepositorioReset`) implementado por cada mundo — associado, técnico e usuário do painel. Nenhuma trava de segurança é reescrita: elas são movidas com teste de contrato escrito antes da extração.

**Tech Stack:** NestJS 11, Prisma, PostgreSQL 17, bcrypt, WhatsApp Cloud API (Meta), Next.js 16 (painel e PWA do técnico).

## Global Constraints

- **Multi-tenant:** toda query autenticada filtra por `tenantId` do JWT. Rotas públicas de recuperação não têm `tenantId` — resolvem por identificador global e falham de forma neutra em ambiguidade.
- **Soft delete:** toda busca inclui `deletedAt: null`. Nunca `delete()` físico.
- **Resposta neutra:** `forgot-password` responde igual exista ou não o cadastro. Nunca revelar existência de conta.
- **O código nunca aparece em log**, nem em nível debug. No banco só o hash bcrypt.
- **Travas do código (valores exatos, herdados do que já roda):** 6 dígitos via `randomInt` do crypto; validade 15 minutos; morre em 5 tentativas erradas; um envio a cada 2 minutos por identificador.
- **Senha nova:** mínimo 6 caracteres, máximo 72 (limite do bcrypt). Para associado e técnico, não pode ser igual ao CPF.
- **Prisma Client:** importar de `.prisma/client`, nunca `@prisma/client`.
- **Roles em inglês, UI em PT-BR.** Rotas do frontend em PT-BR, rotas da API em inglês.
- **Migration aditiva com SQL explícito** (`IF NOT EXISTS`). Nunca `prisma db push` contra produção.
- **Antes de qualquer deploy:** `npx tsc --noEmit`, `npm test` e `app-boot.spec.ts` verdes. tsc passar não garante que o Nest sobe.

## Superfícies e o que muda em cada uma

| Superfície | Hoje | Depois |
|---|---|---|
| App do associado (iOS/Android) | ✓ já tem código no WhatsApp | **nada muda** — passa a usar o serviço compartilhado, comportamento idêntico |
| Painel web `trackgo.site` | e-mail com link | código no WhatsApp |
| PWA do técnico `/tecnico` | "peça uma nova ao escritório" | código no WhatsApp |

**O popup de telefone obrigatório entra no painel e no PWA.** No app do associado ele fica para a próxima build de loja — o binário publicado não muda sem submissão, e o associado já tem o botão de recuperação funcionando.

**Identificador de cada mundo:** associado e técnico informam **CPF**; usuário do painel informa **e-mail** (o model `User` não tem CPF, e o login dele é por e-mail).

---

### Task 1: Campos de recuperação e telefone no banco

**Files:**
- Modify: `backend/prisma/schema.prisma` (models `User`, `Technician`, `Associate`)
- Create: `backend/prisma/migrations/20260910120000_senha_por_whatsapp/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: campos `phone`, `pendingPhone`, `phoneVerifiedAt`, `resetCodeHash`, `resetCodeExpiresAt`, `resetCodeAttempts`, `resetCodeSentAt` em `User` e `Technician`; `pendingPhone` e `phoneVerifiedAt` em `Associate`.

- [ ] **Step 1: Adicionar os campos ao `User`**

Em `backend/prisma/schema.prisma`, no model `User`, logo depois de `resetTokenExpiresAt`:

```prisma
  // --- Recuperação de senha por código no WhatsApp ---
  /// Telefone verificado. Só ele recebe código de recuperação.
  phone               String?   @map("phone")
  /// Número informado no popup, ainda não confirmado por código.
  pendingPhone        String?   @map("pending_phone")
  /// Quando o número foi confirmado por código. Null = não verificado.
  phoneVerifiedAt     DateTime? @map("phone_verified_at")
  /// Hash do código de 6 dígitos (nunca o código em texto puro).
  resetCodeHash       String?   @map("reset_code_hash")
  resetCodeExpiresAt  DateTime? @map("reset_code_expires_at")
  /// Tentativas erradas. Estoura o limite, o código morre.
  resetCodeAttempts   Int       @default(0) @map("reset_code_attempts")
  /// Quando o último código saiu — base do anti-flood.
  resetCodeSentAt     DateTime? @map("reset_code_sent_at")
```

- [ ] **Step 2: Adicionar os campos ao `Technician`**

No model `Technician`, logo depois de `lastLoginAt` (o campo `phone String?` já existe, não duplicar):

```prisma
  // --- Recuperação de senha por código no WhatsApp ---
  pendingPhone        String?   @map("pending_phone")
  phoneVerifiedAt     DateTime? @map("phone_verified_at")
  resetCodeHash       String?   @map("reset_code_hash")
  resetCodeExpiresAt  DateTime? @map("reset_code_expires_at")
  resetCodeAttempts   Int       @default(0) @map("reset_code_attempts")
  resetCodeSentAt     DateTime? @map("reset_code_sent_at")
```

- [ ] **Step 3: Adicionar os campos ao `Associate`**

No model `Associate`, logo depois de `resetCodeSentAt` (os campos `resetCode*` já existem):

```prisma
  /// Número informado no popup, ainda não confirmado por código.
  pendingPhone       String?   @map("pending_phone")
  /// Quando o número foi confirmado por código. Null = não verificado.
  /// Telefone vindo do SGA NÃO conta como verificado — ninguém provou que recebe.
  phoneVerifiedAt    DateTime? @map("phone_verified_at")
```

- [ ] **Step 4: Escrever a migration à mão (aditiva, idempotente)**

Criar `backend/prisma/migrations/20260910120000_senha_por_whatsapp/migration.sql`:

```sql
-- Recuperação de senha por código no WhatsApp: campos aditivos, nada é removido.
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "pending_phone" TEXT;
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "phone_verified_at" TIMESTAMP(3);
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "reset_code_hash" TEXT;
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "reset_code_expires_at" TIMESTAMP(3);
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "reset_code_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users"       ADD COLUMN IF NOT EXISTS "reset_code_sent_at" TIMESTAMP(3);

ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "pending_phone" TEXT;
ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "phone_verified_at" TIMESTAMP(3);
ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "reset_code_hash" TEXT;
ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "reset_code_expires_at" TIMESTAMP(3);
ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "reset_code_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "technicians" ADD COLUMN IF NOT EXISTS "reset_code_sent_at" TIMESTAMP(3);

ALTER TABLE "associates"  ADD COLUMN IF NOT EXISTS "pending_phone" TEXT;
ALTER TABLE "associates"  ADD COLUMN IF NOT EXISTS "phone_verified_at" TIMESTAMP(3);
```

- [ ] **Step 5: Gerar o client e conferir que o schema é válido**

Run: `cd backend && npx prisma validate && npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid` seguido de `Generated Prisma Client`.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(senha): campos de codigo e telefone verificado nos tres mundos"
```

---

### Task 2: `PasswordResetService` — o motor compartilhado

**Files:**
- Create: `backend/src/modules/auth/password-reset.service.ts`
- Create: `backend/src/modules/auth/password-reset.service.spec.ts`
- Modify: `backend/src/modules/notifications/notifications.module.ts`

**Interfaces:**
- Consumes: `WhatsappService.enviarCodigo(telefone: string, codigo: string, minutosValidade: number): Promise<{ enviado: boolean; motivo?: string }>` e o estático `WhatsappService.mascarar(bruto: string): string`, de `../notifications/whatsapp.service`.
- Produces:
  - `interface SujeitoReset { id: string; phone: string | null; resetCodeHash: string | null; resetCodeExpiresAt: Date | null; resetCodeAttempts: number; resetCodeSentAt: Date | null }`
  - `interface RepositorioReset { buscar(identificador: string): Promise<SujeitoReset | null>; gravarCodigo(id: string, hash: string, expiraEm: Date): Promise<void>; contarTentativa(id: string): Promise<void>; limparCodigo(id: string): Promise<void>; gravarSenha(id: string, hash: string): Promise<void> }`
  - `interface RespostaEnvio { message: string; sentTo: string | null; canUseWhatsapp: boolean }`
  - `PasswordResetService.enviarCodigo(repo: RepositorioReset, identificador: string, rotulo: string): Promise<RespostaEnvio>`
  - `PasswordResetService.redefinirSenha(repo: RepositorioReset, identificador: string, codigo: string, novaSenha: string, validarSenha?: (senha: string) => void): Promise<{ ok: true }>`
  - Estáticos `CODIGO_VALIDADE_MIN = 15`, `CODIGO_MAX_TENTATIVAS = 5`, `CODIGO_INTERVALO_MIN = 2`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `backend/src/modules/auth/password-reset.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  PasswordResetService,
  RepositorioReset,
  SujeitoReset,
} from './password-reset.service';
import { WhatsappService } from '../notifications/whatsapp.service';

/** Repositório de mentira: guarda um sujeito em memória e registra o que foi gravado. */
function repoFake(inicial: SujeitoReset | null) {
  let sujeito = inicial;
  const senhasGravadas: string[] = [];
  const repo: RepositorioReset = {
    buscar: async () => sujeito,
    gravarCodigo: async (_id, hash, expiraEm) => {
      sujeito = {
        ...(sujeito as SujeitoReset),
        resetCodeHash: hash,
        resetCodeExpiresAt: expiraEm,
        resetCodeAttempts: 0,
        resetCodeSentAt: new Date(),
      };
    },
    contarTentativa: async () => {
      sujeito = {
        ...(sujeito as SujeitoReset),
        resetCodeAttempts: (sujeito as SujeitoReset).resetCodeAttempts + 1,
      };
    },
    limparCodigo: async () => {
      sujeito = {
        ...(sujeito as SujeitoReset),
        resetCodeHash: null,
        resetCodeExpiresAt: null,
        resetCodeAttempts: 0,
      };
    },
    gravarSenha: async (_id, hash) => {
      senhasGravadas.push(hash);
    },
  };
  return { repo, senhasGravadas, atual: () => sujeito };
}

const SUJEITO: SujeitoReset = {
  id: 'id-1',
  phone: '21999998888',
  resetCodeHash: null,
  resetCodeExpiresAt: null,
  resetCodeAttempts: 0,
  resetCodeSentAt: null,
};

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let enviados: string[];

  beforeEach(async () => {
    enviados = [];
    const whatsapp = {
      habilitado: true,
      enviarCodigo: jest.fn(async (_tel: string, codigo: string) => {
        enviados.push(codigo);
        return { enviado: true };
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: WhatsappService, useValue: whatsapp },
      ],
    }).compile();
    service = mod.get(PasswordResetService);
  });

  it('envia código de 6 dígitos e devolve o telefone mascarado', async () => {
    const fake = repoFake({ ...SUJEITO });
    const res = await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    expect(enviados[0]).toMatch(/^\d{6}$/);
    expect(res.sentTo).toBe('*****-8888');
    expect(fake.atual()?.resetCodeHash).not.toBe(enviados[0]);
    expect(await bcrypt.compare(enviados[0], fake.atual()!.resetCodeHash!)).toBe(true);
  });

  it('responde igual quando o identificador não existe', async () => {
    const semNinguem = repoFake(null);
    const inexistente = await service.enviarCodigo(semNinguem.repo, '00000000000', 'CPF');

    const comAlguem = repoFake({ ...SUJEITO });
    const existente = await service.enviarCodigo(comAlguem.repo, '08577590780', 'CPF');

    expect(inexistente.message).toBe(existente.message);
    expect(inexistente.sentTo).toBeNull();
  });

  it('responde igual quando existe mas não tem telefone', async () => {
    const semTel = repoFake({ ...SUJEITO, phone: null });
    const a = await service.enviarCodigo(semTel.repo, '08577590780', 'CPF');
    const vazio = repoFake(null);
    const b = await service.enviarCodigo(vazio.repo, '00000000000', 'CPF');

    expect(a.message).toBe(b.message);
    expect(a.sentTo).toBeNull();
    expect(enviados).toHaveLength(0);
  });

  it('recusa segundo envio dentro de 2 minutos', async () => {
    const fake = repoFake({ ...SUJEITO, resetCodeSentAt: new Date() });
    const res = await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    expect(enviados).toHaveLength(0);
    expect(res.message).toContain('dois minutos');
  });

  it('redefine a senha com o código certo', async () => {
    const fake = repoFake({ ...SUJEITO });
    await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    const res = await service.redefinirSenha(
      fake.repo,
      '08577590780',
      enviados[0],
      'senhaNova1',
    );

    expect(res).toEqual({ ok: true });
    expect(await bcrypt.compare('senhaNova1', fake.senhasGravadas[0])).toBe(true);
    expect(fake.atual()?.resetCodeHash).toBeNull();
  });

  it('conta a tentativa errada e mata o código na quinta', async () => {
    const fake = repoFake({ ...SUJEITO });
    await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    for (let i = 0; i < 5; i += 1) {
      await expect(
        service.redefinirSenha(fake.repo, '08577590780', '000000', 'senhaNova1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(fake.atual()?.resetCodeHash).toBeNull();
  });

  it('recusa código expirado', async () => {
    const fake = repoFake({
      ...SUJEITO,
      resetCodeHash: await bcrypt.hash('123456', 10),
      resetCodeExpiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.redefinirSenha(fake.repo, '08577590780', '123456', 'senhaNova1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa senha curta', async () => {
    const fake = repoFake({ ...SUJEITO });
    await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    await expect(
      service.redefinirSenha(fake.repo, '08577590780', enviados[0], 'abc'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aplica a validação extra de quem chamou', async () => {
    const fake = repoFake({ ...SUJEITO });
    await service.enviarCodigo(fake.repo, '08577590780', 'CPF');

    await expect(
      service.redefinirSenha(
        fake.repo,
        '08577590780',
        enviados[0],
        '08577590780',
        () => {
          throw new BadRequestException('A nova senha não pode ser o seu CPF. Escolha outra.');
        },
      ),
    ).rejects.toThrow('A nova senha não pode ser o seu CPF. Escolha outra.');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest src/modules/auth/password-reset.service.spec.ts`
Expected: FAIL — `Cannot find module './password-reset.service'`.

- [ ] **Step 3: Implementar o serviço**

Criar `backend/src/modules/auth/password-reset.service.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { WhatsappService } from '../notifications/whatsapp.service';

const BCRYPT_ROUNDS = 10;

/** O que o motor precisa saber sobre quem está recuperando a senha. */
export interface SujeitoReset {
  id: string;
  phone: string | null;
  resetCodeHash: string | null;
  resetCodeExpiresAt: Date | null;
  resetCodeAttempts: number;
  resetCodeSentAt: Date | null;
}

/** Como o motor lê e grava — cada mundo implementa sobre a sua tabela. */
export interface RepositorioReset {
  buscar(identificador: string): Promise<SujeitoReset | null>;
  gravarCodigo(id: string, hash: string, expiraEm: Date): Promise<void>;
  contarTentativa(id: string): Promise<void>;
  limparCodigo(id: string): Promise<void>;
  gravarSenha(id: string, hash: string): Promise<void>;
}

export interface RespostaEnvio {
  message: string;
  sentTo: string | null;
  canUseWhatsapp: boolean;
}

/**
 * Recuperação de senha por código de 6 dígitos no WhatsApp.
 *
 * Motor único do site, do app e do PWA do técnico. Nasceu dentro do
 * `AssociateAuthService` e foi extraído sem mudar uma trava sequer.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  /** Validade do código. Curta de propósito: código vivo é código atacável. */
  static readonly CODIGO_VALIDADE_MIN = 15;
  /** Tentativas erradas antes de o código morrer. */
  static readonly CODIGO_MAX_TENTATIVAS = 5;
  /** Espaçamento mínimo entre envios pro mesmo identificador. */
  static readonly CODIGO_INTERVALO_MIN = 2;

  constructor(private readonly whatsapp: WhatsappService) {}

  /**
   * Gera e envia o código.
   *
   * A resposta é SEMPRE a mesma, exista ou não o cadastro: senão a rota vira
   * verificador de "esse CPF é cliente de vocês?" pra qualquer um na internet.
   * O telefone volta mascarado só quando o envio aconteceu de fato.
   */
  async enviarCodigo(
    repo: RepositorioReset,
    identificador: string,
    rotulo: string,
  ): Promise<RespostaEnvio> {
    const generico: RespostaEnvio = {
      message:
        `Se esse ${rotulo} estiver cadastrado, enviamos um código no WhatsApp. ` +
        'Não chegou em alguns minutos? Fale com a sua associação.',
      sentTo: null,
      canUseWhatsapp: this.whatsapp.habilitado,
    };

    const sujeito = await repo.buscar(identificador);
    if (!sujeito?.phone) {
      if (sujeito) {
        this.logger.warn(`Recuperação pedida sem telefone cadastrado (${rotulo}).`);
      }
      return generico;
    }

    if (sujeito.resetCodeSentAt) {
      const desdeUltimo = Date.now() - sujeito.resetCodeSentAt.getTime();
      if (desdeUltimo < PasswordResetService.CODIGO_INTERVALO_MIN * 60 * 1000) {
        return {
          ...generico,
          message:
            'Já enviamos um código há pouco. Confira o WhatsApp e aguarde ' +
            'dois minutos antes de pedir outro.',
        };
      }
    }

    // randomInt do crypto: previsível é o que não pode ser.
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiraEm = new Date(
      Date.now() + PasswordResetService.CODIGO_VALIDADE_MIN * 60 * 1000,
    );
    await repo.gravarCodigo(
      sujeito.id,
      await bcrypt.hash(codigo, BCRYPT_ROUNDS),
      expiraEm,
    );

    const envio = await this.whatsapp.enviarCodigo(
      sujeito.phone,
      codigo,
      PasswordResetService.CODIGO_VALIDADE_MIN,
    );
    if (!envio.enviado) {
      this.logger.warn(`Não consegui enviar o código (${rotulo}): ${envio.motivo}`);
      return {
        message:
          'No momento não consigo enviar o código pelo WhatsApp. ' +
          'Fale com a sua associação para redefinir a sua senha.',
        sentTo: null,
        canUseWhatsapp: false,
      };
    }

    return { ...generico, sentTo: WhatsappService.mascarar(sujeito.phone) };
  }

  /**
   * Confere o código e grava a senha nova.
   *
   * Erros aqui são específicos de propósito (código errado x expirado): quem
   * chega nesta etapa já provou ter o WhatsApp do titular, e mensagem vaga só
   * atrapalharia quem é legítimo.
   */
  async redefinirSenha(
    repo: RepositorioReset,
    identificador: string,
    codigo: string,
    novaSenha: string,
    validarSenha?: (senha: string) => void,
  ): Promise<{ ok: true }> {
    const digitos = (codigo || '').replace(/\D/g, '');
    const sujeito = await repo.buscar(identificador);

    const invalido = new UnauthorizedException(
      'Código inválido ou expirado. Peça um novo código.',
    );
    if (!sujeito?.resetCodeHash || !sujeito.resetCodeExpiresAt) throw invalido;

    if (sujeito.resetCodeExpiresAt.getTime() < Date.now()) {
      await repo.limparCodigo(sujeito.id);
      throw invalido;
    }
    if (sujeito.resetCodeAttempts >= PasswordResetService.CODIGO_MAX_TENTATIVAS) {
      await repo.limparCodigo(sujeito.id);
      throw new UnauthorizedException('Muitas tentativas erradas. Peça um novo código.');
    }

    if (!(await bcrypt.compare(digitos, sujeito.resetCodeHash))) {
      // Conta a tentativa ANTES de responder — senão força bruta é de graça.
      await repo.contarTentativa(sujeito.id);
      if (
        sujeito.resetCodeAttempts + 1 >=
        PasswordResetService.CODIGO_MAX_TENTATIVAS
      ) {
        await repo.limparCodigo(sujeito.id);
      }
      throw invalido;
    }

    validarSenha?.(novaSenha);
    if (novaSenha.trim().length < 6) {
      throw new BadRequestException('A nova senha precisa ter ao menos 6 caracteres.');
    }

    await repo.gravarSenha(sujeito.id, await bcrypt.hash(novaSenha, BCRYPT_ROUNDS));
    await repo.limparCodigo(sujeito.id);
    this.logger.log(`Senha redefinida por código (final ${identificador.slice(-4)}).`);
    return { ok: true };
  }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `cd backend && npx jest src/modules/auth/password-reset.service.spec.ts`
Expected: PASS — 9 testes.

- [ ] **Step 5: Registrar o serviço onde o `WhatsappService` mora**

Em `backend/src/modules/notifications/notifications.module.ts`, importar `PasswordResetService` de `../auth/password-reset.service` e adicioná-lo a `providers` e a `exports`, ao lado do `WhatsappService`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/auth/password-reset.service.ts backend/src/modules/auth/password-reset.service.spec.ts backend/src/modules/notifications/notifications.module.ts
git commit -m "feat(senha): motor unico de codigo de recuperacao por WhatsApp"
```

---

### Task 3: Associado passa a usar o motor compartilhado

O comportamento visto pelo app **não pode mudar** — ele está publicado nas lojas e não será rebuildado agora. Por isso o teste de contrato vem antes da mudança.

**Files:**
- Create: `backend/src/modules/app/associate-reset-contrato.spec.ts`
- Modify: `backend/src/modules/app/associate-auth.service.ts`

**Interfaces:**
- Consumes: `PasswordResetService` (Task 2), `docVariants`/`normalizeDoc` de `./documento`.
- Produces: `AssociateAuthService.forgotPassword(rawCpf)` e `.resetPasswordWithCode(rawCpf, codigo, novaSenha)` com assinatura e respostas idênticas às atuais.

- [ ] **Step 1: Escrever o teste de contrato**

Criar `backend/src/modules/app/associate-reset-contrato.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AssociateAuthService } from './associate-auth.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Trava o contrato que o app publicado nas lojas já consome. O binário não
 * será rebuildado agora: qualquer mudança de forma aqui quebra cliente real.
 */
describe('Contrato de recuperação do associado', () => {
  const associado = {
    id: 'a-1',
    phone: '21999998888',
    resetCodeHash: null as string | null,
    resetCodeExpiresAt: null as Date | null,
    resetCodeAttempts: 0,
    resetCodeSentAt: null as Date | null,
  };

  let service: AssociateAuthService;

  beforeEach(async () => {
    const prisma = {
      associate: {
        findFirst: jest.fn(async () => associado),
        update: jest.fn(async () => associado),
      },
    };
    const whatsapp = {
      habilitado: true,
      enviarCodigo: jest.fn(async () => ({ enviado: true })),
    };
    const mod = await Test.createTestingModule({
      providers: [
        AssociateAuthService,
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsapp },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
      ],
    }).compile();
    service = mod.get(AssociateAuthService);
  });

  it('devolve message, sentTo e canUseWhatsapp', async () => {
    const res = await service.forgotPassword('08577590780');
    expect(Object.keys(res).sort()).toEqual(['canUseWhatsapp', 'message', 'sentTo']);
    expect(res.sentTo).toBe('*****-8888');
  });

  it('CPF fora do formato devolve a resposta genérica, sem enviar', async () => {
    const res = await service.forgotPassword('123');
    expect(res.sentTo).toBeNull();
    expect(res.message).toContain('Se esse CPF estiver cadastrado');
  });
});
```

- [ ] **Step 2: Rodar e ver passar com o código atual**

Run: `cd backend && npx jest src/modules/app/associate-reset-contrato.spec.ts`
Expected: PASS. Este é o ponto de referência — se falhar aqui, o teste está errado, não o código.

- [ ] **Step 3: Trocar o miolo por chamadas ao motor**

Em `backend/src/modules/app/associate-auth.service.ts`:

1. Injetar o motor no construtor, ao lado do que já existe:

```ts
    private readonly reset: PasswordResetService,
```

com `import { PasswordResetService, RepositorioReset } from '../auth/password-reset.service';`

2. Criar o repositório do associado como método privado:

```ts
  /** Port do motor de recuperação sobre a tabela de associados. */
  private repoReset(): RepositorioReset {
    return {
      buscar: async (doc) => {
        const a = await this.prisma.associate.findFirst({
          where: { cpf: { in: docVariants(doc) }, deletedAt: null },
          select: {
            id: true,
            phone: true,
            resetCodeHash: true,
            resetCodeExpiresAt: true,
            resetCodeAttempts: true,
            resetCodeSentAt: true,
          },
        });
        return a ?? null;
      },
      gravarCodigo: async (id, hash, expiraEm) => {
        await this.prisma.associate.update({
          where: { id },
          data: {
            resetCodeHash: hash,
            resetCodeExpiresAt: expiraEm,
            resetCodeAttempts: 0,
            resetCodeSentAt: new Date(),
          },
        });
      },
      contarTentativa: async (id) => {
        await this.prisma.associate.update({
          where: { id },
          data: { resetCodeAttempts: { increment: 1 } },
        });
      },
      limparCodigo: async (id) => {
        await this.limparCodigo(id);
      },
      gravarSenha: async (id, hash) => {
        await this.prisma.associate.update({
          where: { id },
          data: { password: hash, mustChangePassword: false },
        });
      },
    };
  }
```

3. Substituir o corpo de `forgotPassword` por:

```ts
  async forgotPassword(rawCpf: string) {
    const cpf = normalizeDoc(rawCpf);
    // CPF (11) ou CNPJ (14): a base tem associado pessoa jurídica.
    if (cpf.length !== 11 && cpf.length !== 14) {
      return {
        message:
          'Se esse CPF estiver cadastrado, enviamos um código no WhatsApp. ' +
          'Não chegou em alguns minutos? Fale com a sua associação.',
        sentTo: null,
        canUseWhatsapp: this.whatsapp.habilitado,
      };
    }
    return this.reset.enviarCodigo(this.repoReset(), cpf, 'CPF');
  }
```

4. Substituir o corpo de `resetPasswordWithCode` por:

```ts
  async resetPasswordWithCode(
    rawCpf: string,
    codigo: string,
    novaSenha: string,
  ): Promise<{ ok: true }> {
    const cpf = normalizeDoc(rawCpf);
    return this.reset.redefinirSenha(
      this.repoReset(),
      cpf,
      codigo,
      novaSenha,
      (senha) => {
        if (normalizeDoc(senha) === cpf) {
          throw new BadRequestException(
            'A nova senha não pode ser o seu CPF. Escolha outra.',
          );
        }
      },
    );
  }
```

5. Remover as constantes `CODIGO_VALIDADE_MIN`, `CODIGO_MAX_TENTATIVAS` e `CODIGO_INTERVALO_MIN` do `AssociateAuthService` — passam a viver no motor. Manter `limparCodigo`, ainda usado pelo port.

- [ ] **Step 4: Rodar o contrato e a suíte do módulo**

Run: `cd backend && npx jest src/modules/app src/modules/auth`
Expected: PASS, incluindo `associate-reset-contrato.spec.ts`, `associate-login-documento.spec.ts` e `app-data.contrato.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/app
git commit -m "refactor(senha): associado passa a usar o motor compartilhado"
```

---

### Task 4: "Esqueci a senha" do técnico (backend + PWA)

**Files:**
- Create: `backend/src/modules/tech/dto/forgot-password.dto.ts`
- Create: `backend/src/modules/tech/tech-reset.spec.ts`
- Modify: `backend/src/modules/tech/tech-auth.service.ts`
- Modify: `backend/src/modules/tech/tech-auth.controller.ts`
- Modify: `backend/src/modules/tech/tech.module.ts`
- Modify: `frontend/dashboard/src/lib/tech-api.ts`
- Modify: `frontend/dashboard/src/app/tecnico/page.tsx`

**Interfaces:**
- Consumes: `PasswordResetService` (Task 2), campos `resetCode*` do `Technician` (Task 1).
- Produces:
  - `POST /api/v1/tech/auth/forgot-password` body `{ cpf: string }` → `{ message, sentTo, canUseWhatsapp }`
  - `POST /api/v1/tech/auth/reset-password` body `{ cpf: string; code: string; newPassword: string }` → `{ ok: true }`
  - `techApi.forgotPassword(cpf: string)` e `techApi.resetPassword(cpf: string, code: string, newPassword: string)`

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/src/modules/tech/tech-reset.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { TechAuthService } from './tech-auth.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Recuperação de senha do técnico', () => {
  let service: TechAuthService;
  let tecnico: Record<string, unknown>;
  let enviados: string[];
  let gravado: Record<string, unknown> | null;

  beforeEach(async () => {
    enviados = [];
    gravado = null;
    tecnico = {
      id: 't-1',
      name: 'Marcos',
      phone: '21988887777',
      resetCodeHash: null,
      resetCodeExpiresAt: null,
      resetCodeAttempts: 0,
      resetCodeSentAt: null,
    };
    const prisma = {
      technician: {
        findFirst: jest.fn(async () => tecnico),
        findMany: jest.fn(async () => [tecnico]),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          tecnico = { ...tecnico, ...data };
          gravado = data;
          return tecnico;
        }),
      },
    };
    const whatsapp = {
      habilitado: true,
      enviarCodigo: jest.fn(async (_tel: string, codigo: string) => {
        enviados.push(codigo);
        return { enviado: true };
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        TechAuthService,
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsapp },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
      ],
    }).compile();
    service = mod.get(TechAuthService);
  });

  it('envia o código pro WhatsApp do técnico', async () => {
    const res = await service.forgotPassword('12345678901');
    expect(enviados[0]).toMatch(/^\d{6}$/);
    expect(res.sentTo).toBe('*****-7777');
  });

  it('grava a senha nova e libera o mustChangePassword', async () => {
    await service.forgotPassword('12345678901');
    const res = await service.resetPasswordWithCode(
      '12345678901',
      enviados[0],
      'senhaDoTecnico1',
    );

    expect(res).toEqual({ ok: true });
    expect(await bcrypt.compare('senhaDoTecnico1', gravado!.password as string)).toBe(true);
    expect(gravado!.mustChangePassword).toBe(false);
  });

  it('recusa código errado', async () => {
    await service.forgotPassword('12345678901');
    await expect(
      service.resetPasswordWithCode('12345678901', '000000', 'senhaDoTecnico1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa senha igual ao CPF', async () => {
    await service.forgotPassword('12345678901');
    await expect(
      service.resetPasswordWithCode('12345678901', enviados[0], '12345678901'),
    ).rejects.toThrow('A nova senha não pode ser o seu CPF. Escolha outra.');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest src/modules/tech/tech-reset.spec.ts`
Expected: FAIL — `service.forgotPassword is not a function`.

- [ ] **Step 3: Implementar no `TechAuthService`**

Em `backend/src/modules/tech/tech-auth.service.ts`, adicionar os imports e injetar o motor:

```ts
import { BadRequestException } from '@nestjs/common';
import { PasswordResetService, RepositorioReset } from '../auth/password-reset.service';
```

No construtor, acrescentar `private readonly reset: PasswordResetService,`.

Adicionar ao final da classe:

```ts
  /**
   * Port do motor de recuperação sobre a tabela de técnicos.
   *
   * Rota pública, antes do login: não há `tenantId`. O CPF é único por tenant,
   * então a busca global pode encontrar homônimos em tenants diferentes —
   * nesse caso não enviamos nada e a resposta genérica cobre o caso.
   */
  private repoReset(): RepositorioReset {
    return {
      buscar: async (cpf) => {
        const candidatos = await this.prisma.technician.findMany({
          where: { cpf, deletedAt: null, active: true },
          select: {
            id: true,
            phone: true,
            resetCodeHash: true,
            resetCodeExpiresAt: true,
            resetCodeAttempts: true,
            resetCodeSentAt: true,
          },
        });
        return candidatos.length === 1 ? candidatos[0] : null;
      },
      gravarCodigo: async (id, hash, expiraEm) => {
        await this.prisma.technician.update({
          where: { id },
          data: {
            resetCodeHash: hash,
            resetCodeExpiresAt: expiraEm,
            resetCodeAttempts: 0,
            resetCodeSentAt: new Date(),
          },
        });
      },
      contarTentativa: async (id) => {
        await this.prisma.technician.update({
          where: { id },
          data: { resetCodeAttempts: { increment: 1 } },
        });
      },
      limparCodigo: async (id) => {
        await this.prisma.technician.update({
          where: { id },
          data: {
            resetCodeHash: null,
            resetCodeExpiresAt: null,
            resetCodeAttempts: 0,
          },
        });
      },
      gravarSenha: async (id, hash) => {
        await this.prisma.technician.update({
          where: { id },
          // A senha escolhida pelo técnico já é a definitiva.
          data: { password: hash, mustChangePassword: false },
        });
      },
    };
  }

  async forgotPassword(rawCpf: string) {
    return this.reset.enviarCodigo(this.repoReset(), normalizeCpf(rawCpf), 'CPF');
  }

  async resetPasswordWithCode(rawCpf: string, codigo: string, novaSenha: string) {
    const cpf = normalizeCpf(rawCpf);
    return this.reset.redefinirSenha(
      this.repoReset(),
      cpf,
      codigo,
      novaSenha,
      (senha) => {
        if (senha.replace(/\D/g, '') === cpf) {
          throw new BadRequestException(
            'A nova senha não pode ser o seu CPF. Escolha outra.',
          );
        }
      },
    );
  }
```

- [ ] **Step 4: Criar o DTO**

Criar `backend/src/modules/tech/dto/forgot-password.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

/** Pedido do código de recuperação do técnico — só o CPF. */
export class TechForgotPasswordDto {
  @ApiProperty({ example: '12345678901' })
  @IsString()
  @Length(11, 14, { message: 'Informe um CPF válido.' })
  cpf!: string;
}

/** Confirmação do código + senha nova. */
export class TechResetPasswordDto {
  @ApiProperty({ example: '12345678901' })
  @IsString()
  @Length(11, 14, { message: 'Informe um CPF válido.' })
  cpf!: string;

  @ApiProperty({ example: '482913', description: 'Código de 6 dígitos' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 números.' })
  code!: string;

  @ApiProperty({ description: 'Nova senha escolhida pelo técnico' })
  @IsString()
  @MinLength(6, { message: 'A nova senha precisa ter ao menos 6 caracteres.' })
  @MaxLength(72)
  newPassword!: string;
}
```

- [ ] **Step 5: Expor as rotas**

Em `backend/src/modules/tech/tech-auth.controller.ts`, importar os DTOs e adicionar, logo depois de `login`:

```ts
  @Public()
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Envia código de 6 dígitos no WhatsApp cadastrado do técnico',
    description:
      'Responde igual exista ou não o CPF. Um envio a cada 2 minutos por CPF.',
  })
  forgotPassword(@Body() dto: TechForgotPasswordDto) {
    return this.service.forgotPassword(dto.cpf);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Confere o código e grava a senha nova' })
  resetPassword(@Body() dto: TechResetPasswordDto) {
    return this.service.resetPasswordWithCode(dto.cpf, dto.code, dto.newPassword);
  }
```

Em `backend/src/modules/tech/tech.module.ts`, garantir que o módulo importe o módulo onde `PasswordResetService` é exportado (o de notificações, Task 2 Step 5).

- [ ] **Step 6: Rodar os testes**

Run: `cd backend && npx jest src/modules/tech`
Expected: PASS.

- [ ] **Step 7: Cliente no frontend**

Em `frontend/dashboard/src/lib/tech-api.ts`, adicionar ao objeto `techApi`:

```ts
  forgotPassword: async (cpf: string) => {
    const res = await api.post('/tech/auth/forgot-password', { cpf });
    return res.data.data as { message: string; sentTo: string | null; canUseWhatsapp: boolean };
  },
  resetPassword: async (cpf: string, code: string, newPassword: string) => {
    const res = await api.post('/tech/auth/reset-password', { cpf, code, newPassword });
    return res.data.data as { ok: true };
  },
```

Seguir exatamente o padrão de `techApi.login` do arquivo (mesma instância `api`, mesmo desembrulho de `data.data`).

- [ ] **Step 8: Tela no PWA**

Em `frontend/dashboard/src/app/tecnico/page.tsx`:

1. Em `LoginScreen`, trocar o parágrafo da linha 240 por um botão:

```tsx
      <button
        type="button"
        onClick={onForgot}
        className="mt-6 w-full text-center text-sm font-medium text-brand-orange-500 underline-offset-4 hover:underline"
      >
        Esqueci minha senha
      </button>
```

e receber `onForgot: () => void` nas props de `LoginScreen`.

2. Criar o componente de recuperação em duas etapas, no mesmo arquivo, seguindo o estilo de `ChangePasswordScreen`:

```tsx
/* ----------------------- Esqueci minha senha ---------------------------- */

function ForgotPasswordScreen({ onBack }: { onBack: () => void }) {
  const [etapa, setEtapa] = useState<'cpf' | 'codigo'>('cpf');
  const [cpf, setCpf] = useState('');
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [loading, setLoading] = useState(false);

  const pedirCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cpf.replace(/\D/g, '').length !== 11) {
      toast.error('Digite o CPF completo.');
      return;
    }
    setLoading(true);
    try {
      const res = await techApi.forgotPassword(cpf.replace(/\D/g, ''));
      setEnviadoPara(res.sentTo);
      toast.success(res.message);
      setEtapa('codigo');
    } catch (err) {
      toast.error(apiMessage(err, 'Não consegui enviar o código'));
    } finally {
      setLoading(false);
    }
  };

  const definirSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senha.length < 6) {
      toast.error('A nova senha precisa ter ao menos 6 caracteres.');
      return;
    }
    setLoading(true);
    try {
      await techApi.resetPassword(cpf.replace(/\D/g, ''), codigo, senha);
      toast.success('Senha alterada. Entre com a senha nova.');
      onBack();
    } catch (err) {
      toast.error(apiMessage(err, 'Código inválido ou expirado'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[80dvh] flex-col justify-center">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-orange-500/15">
          <KeyRound className="h-7 w-7 text-brand-orange-500" />
        </div>
        <h1 className="text-xl font-bold">Esqueci minha senha</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {etapa === 'cpf'
            ? 'Enviamos um código no seu WhatsApp cadastrado.'
            : `Código enviado para ${enviadoPara ?? 'o seu WhatsApp'}. Vale 15 minutos.`}
        </p>
      </div>

      {etapa === 'cpf' ? (
        <form onSubmit={pedirCodigo} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cpf-recuperar">CPF</Label>
            <Input
              id="cpf-recuperar"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              inputMode="numeric"
              className="h-12 text-lg"
            />
          </div>
          <Button type="submit" className="h-12 w-full text-base" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
            Enviar código
          </Button>
        </form>
      ) : (
        <form onSubmit={definirSenha} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="codigo">Código de 6 números</Label>
            <Input
              id="codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              className="h-12 text-center text-2xl tracking-[0.4em]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nova-senha">Nova senha</Label>
            <Input
              id="nova-senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="h-12 text-lg"
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" className="h-12 w-full text-base" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
            Salvar senha
          </Button>
        </form>
      )}

      <button
        type="button"
        onClick={onBack}
        className="mt-6 text-center text-sm text-muted-foreground"
      >
        Voltar para o login
      </button>
    </div>
  );
}
```

3. No componente raiz da página, guardar a tela atual e renderizar:

```tsx
  const [recuperando, setRecuperando] = useState(false);
  // ...
  if (!me) {
    return recuperando ? (
      <ForgotPasswordScreen onBack={() => setRecuperando(false)} />
    ) : (
      <LoginScreen onLogged={loadMe} onForgot={() => setRecuperando(true)} />
    );
  }
```

- [ ] **Step 9: Conferir tipos do frontend**

Run: `cd frontend/dashboard && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/tech frontend/dashboard/src/app/tecnico frontend/dashboard/src/lib/tech-api.ts
git commit -m "feat(senha): tecnico recupera a senha por codigo no WhatsApp"
```

---

### Task 5: "Esqueci a senha" do painel por WhatsApp (backend + web)

O painel deixa de mandar link por e-mail. O fluxo de e-mail continua no código, sem porta de entrada na interface — remover é decisão do dono.

**Files:**
- Create: `backend/src/modules/auth/user-reset.spec.ts`
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/src/modules/auth/dto/forgot-password.dto.ts`
- Modify: `frontend/dashboard/src/lib/api.ts`
- Modify: `frontend/dashboard/src/app/(auth)/forgot-password/page.tsx`

**Interfaces:**
- Consumes: `PasswordResetService` (Task 2), campos `resetCode*` do `User` (Task 1).
- Produces:
  - `POST /api/v1/auth/forgot-password-whatsapp` body `{ email: string }` → `{ message, sentTo, canUseWhatsapp }`
  - `POST /api/v1/auth/reset-password-whatsapp` body `{ email: string; code: string; newPassword: string }` → `{ ok: true }`
  - `authApi.forgotPasswordWhatsapp(email)` e `authApi.resetPasswordWhatsapp(email, code, newPassword)`

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/src/modules/auth/user-reset.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

describe('Recuperação de senha do painel por WhatsApp', () => {
  let service: AuthService;
  let usuario: Record<string, unknown>;
  let enviados: string[];
  let gravado: Record<string, unknown> | null;

  beforeEach(async () => {
    enviados = [];
    gravado = null;
    usuario = {
      id: 'u-1',
      email: 'operador@21go.com.br',
      phone: '21977776666',
      resetCodeHash: null,
      resetCodeExpiresAt: null,
      resetCodeAttempts: 0,
      resetCodeSentAt: null,
    };
    const prisma = {
      user: {
        findFirst: jest.fn(async () => usuario),
        findUnique: jest.fn(async () => usuario),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          usuario = { ...usuario, ...data };
          gravado = data;
          return usuario;
        }),
      },
    };
    const whatsapp = {
      habilitado: true,
      enviarCodigo: jest.fn(async (_tel: string, codigo: string) => {
        enviados.push(codigo);
        return { enviado: true };
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsapp },
        { provide: EmailService, useValue: { sendPasswordReset: jest.fn() } },
        { provide: JwtService, useValue: { sign: () => 'jwt' } },
      ],
    }).compile();
    service = mod.get(AuthService);
  });

  it('envia o código pro WhatsApp do usuário do painel', async () => {
    const res = await service.forgotPasswordWhatsapp('operador@21go.com.br');
    expect(enviados[0]).toMatch(/^\d{6}$/);
    expect(res.sentTo).toBe('*****-6666');
  });

  it('grava a senha nova com o código certo', async () => {
    await service.forgotPasswordWhatsapp('operador@21go.com.br');
    const res = await service.resetPasswordWhatsapp(
      'operador@21go.com.br',
      enviados[0],
      'senhaDoPainel1',
    );

    expect(res).toEqual({ ok: true });
    expect(await bcrypt.compare('senhaDoPainel1', gravado!.password as string)).toBe(true);
  });

  it('recusa código errado', async () => {
    await service.forgotPasswordWhatsapp('operador@21go.com.br');
    await expect(
      service.resetPasswordWhatsapp('operador@21go.com.br', '000000', 'senhaDoPainel1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest src/modules/auth/user-reset.spec.ts`
Expected: FAIL — `service.forgotPasswordWhatsapp is not a function`.

- [ ] **Step 3: Implementar no `AuthService`**

Em `backend/src/modules/auth/auth.service.ts`, injetar `private readonly reset: PasswordResetService,` no construtor e adicionar:

```ts
  /** Port do motor de recuperação sobre a tabela de usuários do painel. */
  private repoReset(): RepositorioReset {
    return {
      buscar: async (email) => {
        const u = await this.prisma.user.findFirst({
          where: { email: email.trim().toLowerCase(), active: true, deletedAt: null },
          select: {
            id: true,
            phone: true,
            resetCodeHash: true,
            resetCodeExpiresAt: true,
            resetCodeAttempts: true,
            resetCodeSentAt: true,
          },
        });
        return u ?? null;
      },
      gravarCodigo: async (id, hash, expiraEm) => {
        await this.prisma.user.update({
          where: { id },
          data: {
            resetCodeHash: hash,
            resetCodeExpiresAt: expiraEm,
            resetCodeAttempts: 0,
            resetCodeSentAt: new Date(),
          },
        });
      },
      contarTentativa: async (id) => {
        await this.prisma.user.update({
          where: { id },
          data: { resetCodeAttempts: { increment: 1 } },
        });
      },
      limparCodigo: async (id) => {
        await this.prisma.user.update({
          where: { id },
          data: {
            resetCodeHash: null,
            resetCodeExpiresAt: null,
            resetCodeAttempts: 0,
          },
        });
      },
      gravarSenha: async (id, hash) => {
        await this.prisma.user.update({
          where: { id },
          // Invalida também o token de e-mail: uma recuperação encerra a outra.
          data: { password: hash, resetTokenHash: null, resetTokenExpiresAt: null },
        });
      },
    };
  }

  async forgotPasswordWhatsapp(email: string) {
    return this.reset.enviarCodigo(this.repoReset(), email, 'e-mail');
  }

  async resetPasswordWhatsapp(email: string, codigo: string, novaSenha: string) {
    return this.reset.redefinirSenha(this.repoReset(), email, codigo, novaSenha);
  }
```

com `import { PasswordResetService, RepositorioReset } from './password-reset.service';`

- [ ] **Step 4: DTOs e rotas**

Em `backend/src/modules/auth/dto/forgot-password.dto.ts`, adicionar:

```ts
/** Confirmação do código recebido no WhatsApp + senha nova. */
export class ResetPasswordWhatsappDto {
  @ApiProperty({ example: 'operador@21go.com.br' })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email!: string;

  @ApiProperty({ example: '482913', description: 'Código de 6 dígitos' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 números.' })
  code!: string;

  @ApiProperty({ description: 'Nova senha' })
  @IsString()
  @MinLength(6, { message: 'A nova senha precisa ter ao menos 6 caracteres.' })
  @MaxLength(72)
  newPassword!: string;
}
```

ajustando os imports de `class-validator` para incluir `IsString`, `Matches`, `MinLength`, `MaxLength`.

Em `backend/src/modules/auth/auth.controller.ts`, adicionar:

```ts
  @Public()
  @Post('forgot-password-whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Envia código de 6 dígitos no WhatsApp cadastrado do usuário',
    description: 'Responde igual exista ou não o e-mail. Um envio a cada 2 minutos.',
  })
  forgotPasswordWhatsapp(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPasswordWhatsapp(dto.email);
  }

  @Public()
  @Post('reset-password-whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confere o código e grava a senha nova' })
  resetPasswordWhatsapp(@Body() dto: ResetPasswordWhatsappDto) {
    return this.authService.resetPasswordWhatsapp(dto.email, dto.code, dto.newPassword);
  }
```

Copiar os decoradores exatamente como as rotas vizinhas do arquivo usam (`@Public()`, `@HttpCode`) — se `forgot-password` atual não usa `@HttpCode`, não usar aqui também.

- [ ] **Step 5: Rodar os testes do módulo**

Run: `cd backend && npx jest src/modules/auth`
Expected: PASS.

- [ ] **Step 6: Cliente e tela no painel**

Em `frontend/dashboard/src/lib/api.ts`, adicionar ao `authApi`:

```ts
  forgotPasswordWhatsapp: async (email: string) => {
    const res = await api.post<ApiResponse<{ message: string; sentTo: string | null; canUseWhatsapp: boolean }>>(
      '/auth/forgot-password-whatsapp',
      { email },
    );
    return res.data.data;
  },
  resetPasswordWhatsapp: async (email: string, code: string, newPassword: string) => {
    await api.post('/auth/reset-password-whatsapp', { email, code, newPassword });
  },
```

Em `frontend/dashboard/src/app/(auth)/forgot-password/page.tsx`, trocar o fluxo de uma etapa (e-mail → aviso) por duas etapas: e-mail → código + senha nova. Manter `BrandHeader`, o layout e os componentes já usados no arquivo. O `onSubmit` da primeira etapa chama `authApi.forgotPasswordWhatsapp(email)` e guarda `sentTo`; a segunda etapa mostra dois campos (código de 6 dígitos e nova senha) e chama `authApi.resetPasswordWhatsapp`, redirecionando para `/login` com `toast.success('Senha alterada. Entre com a senha nova.')`. Trocar o ícone `Mail` por `MessageCircle` de `lucide-react` e o texto para explicar que o código chega no WhatsApp cadastrado.

- [ ] **Step 7: Conferir tipos**

Run: `cd frontend/dashboard && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/auth frontend/dashboard/src/lib/api.ts "frontend/dashboard/src/app/(auth)/forgot-password/page.tsx"
git commit -m "feat(senha): painel recupera a senha por codigo no WhatsApp"
```

---

### Task 6: Popup obrigatório de WhatsApp no login

Quem não tem telefone verificado não navega. Vale para o painel e para o PWA do técnico. O bloqueio é de interface: as rotas de dados continuam respondendo normalmente, para que uma falha aqui nunca derrube o sistema inteiro (Regra 0 — produção não pode cair).

**Files:**
- Create: `backend/src/modules/auth/phone-verification.service.ts`
- Create: `backend/src/modules/auth/phone-verification.spec.ts`
- Create: `frontend/dashboard/src/components/auth/verificar-whatsapp-dialog.tsx`
- Modify: `backend/src/modules/auth/auth.controller.ts`
- Modify: `backend/src/modules/tech/tech-auth.controller.ts`
- Modify: `backend/src/modules/auth/auth.service.ts` (expor `phoneVerified` no `/auth/me`)
- Modify: `backend/src/modules/tech/tech-auth.service.ts` (expor `phoneVerified` no `/tech/auth/me`)
- Modify: `frontend/dashboard/src/app/(dashboard)/layout.tsx`
- Modify: `frontend/dashboard/src/app/tecnico/page.tsx`

**Interfaces:**
- Consumes: `WhatsappService`, campos `pendingPhone`/`phoneVerifiedAt` (Task 1).
- Produces:
  - `POST /api/v1/auth/phone/start` body `{ phone: string }` → `{ sentTo: string }` (autenticado)
  - `POST /api/v1/auth/phone/confirm` body `{ code: string }` → `{ ok: true }` (autenticado)
  - `POST /api/v1/tech/auth/phone/start` e `.../confirm` (mesmos corpos, guard do técnico)
  - `/auth/me` e `/tech/auth/me` passam a devolver `phoneVerified: boolean`

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/src/modules/auth/phone-verification.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PhoneVerificationService } from './phone-verification.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Verificação de WhatsApp no login', () => {
  let service: PhoneVerificationService;
  let registro: Record<string, unknown>;
  let enviados: string[];

  beforeEach(async () => {
    enviados = [];
    registro = {
      id: 'u-1',
      pendingPhone: null,
      phoneVerifiedAt: null,
      resetCodeHash: null,
      resetCodeExpiresAt: null,
      resetCodeAttempts: 0,
      resetCodeSentAt: null,
    };
    const prisma = {
      user: {
        findFirst: jest.fn(async () => registro),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          registro = { ...registro, ...data };
          return registro;
        }),
      },
    };
    const whatsapp = {
      habilitado: true,
      enviarCodigo: jest.fn(async (_tel: string, codigo: string) => {
        enviados.push(codigo);
        return { enviado: true };
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        PhoneVerificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsapp },
      ],
    }).compile();
    service = mod.get(PhoneVerificationService);
  });

  it('envia código pro número informado e guarda como pendente', async () => {
    const res = await service.iniciar('user', 'u-1', '(21) 97777-6666');
    expect(enviados[0]).toMatch(/^\d{6}$/);
    expect(res.sentTo).toBe('*****-6666');
    expect(registro.pendingPhone).toBe('5521977776666');
    // Só vira telefone de verdade depois de confirmado.
    expect(registro.phoneVerifiedAt).toBeNull();
  });

  it('recusa número curto sem enviar nada', async () => {
    await expect(service.iniciar('user', 'u-1', '123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(enviados).toHaveLength(0);
  });

  it('promove o pendente a verificado quando o código confere', async () => {
    await service.iniciar('user', 'u-1', '21977776666');
    const res = await service.confirmar('user', 'u-1', enviados[0]);

    expect(res).toEqual({ ok: true });
    expect(registro.phone).toBe('5521977776666');
    expect(registro.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(registro.pendingPhone).toBeNull();
  });

  it('não verifica nada com código errado', async () => {
    await service.iniciar('user', 'u-1', '21977776666');
    await expect(service.confirmar('user', 'u-1', '000000')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(registro.phoneVerifiedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest src/modules/auth/phone-verification.spec.ts`
Expected: FAIL — `Cannot find module './phone-verification.service'`.

- [ ] **Step 3: Implementar o serviço**

Criar `backend/src/modules/auth/phone-verification.service.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../notifications/whatsapp.service';

const BCRYPT_ROUNDS = 10;
const VALIDADE_MIN = 15;

/** Qual tabela está sendo verificada. */
export type MundoVerificavel = 'user' | 'technician';

/**
 * Cadastro e confirmação do WhatsApp no login.
 *
 * O número informado fica em `pendingPhone` até o código conferir — assim um
 * número digitado errado nunca substitui o telefone bom que já estava lá.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  private tabela(mundo: MundoVerificavel) {
    return mundo === 'user' ? this.prisma.user : this.prisma.technician;
  }

  async iniciar(mundo: MundoVerificavel, id: string, telefone: string) {
    const numero = WhatsappService.normalizarNumero(telefone);
    if (!numero) {
      throw new BadRequestException('Informe um número de WhatsApp com DDD.');
    }

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await (this.tabela(mundo) as { update: Function }).update({
      where: { id },
      data: {
        pendingPhone: numero,
        resetCodeHash: await bcrypt.hash(codigo, BCRYPT_ROUNDS),
        resetCodeExpiresAt: new Date(Date.now() + VALIDADE_MIN * 60 * 1000),
        resetCodeAttempts: 0,
        resetCodeSentAt: new Date(),
      },
    });

    const envio = await this.whatsapp.enviarCodigo(numero, codigo, VALIDADE_MIN);
    if (!envio.enviado) {
      throw new BadRequestException(
        'Não consegui enviar o código para esse número. Confira e tente de novo.',
      );
    }
    return { sentTo: WhatsappService.mascarar(numero) };
  }

  async confirmar(mundo: MundoVerificavel, id: string, codigo: string) {
    const registro = await (this.tabela(mundo) as { findFirst: Function }).findFirst({
      where: { id },
      select: {
        id: true,
        pendingPhone: true,
        resetCodeHash: true,
        resetCodeExpiresAt: true,
        resetCodeAttempts: true,
      },
    });

    const invalido = new UnauthorizedException(
      'Código inválido ou expirado. Peça um novo código.',
    );
    if (!registro?.resetCodeHash || !registro.pendingPhone) throw invalido;
    if (
      !registro.resetCodeExpiresAt ||
      registro.resetCodeExpiresAt.getTime() < Date.now()
    ) {
      throw invalido;
    }
    if (registro.resetCodeAttempts >= 5) {
      throw new UnauthorizedException('Muitas tentativas erradas. Peça um novo código.');
    }
    if (!(await bcrypt.compare((codigo || '').replace(/\D/g, ''), registro.resetCodeHash))) {
      await (this.tabela(mundo) as { update: Function }).update({
        where: { id },
        data: { resetCodeAttempts: { increment: 1 } },
      });
      throw invalido;
    }

    await (this.tabela(mundo) as { update: Function }).update({
      where: { id },
      data: {
        phone: registro.pendingPhone,
        phoneVerifiedAt: new Date(),
        pendingPhone: null,
        resetCodeHash: null,
        resetCodeExpiresAt: null,
        resetCodeAttempts: 0,
      },
    });
    this.logger.log(`WhatsApp verificado (${mundo}).`);
    return { ok: true };
  }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `cd backend && npx jest src/modules/auth/phone-verification.spec.ts`
Expected: PASS — 4 testes.

- [ ] **Step 5: Expor as rotas e a flag**

Em `backend/src/modules/auth/auth.controller.ts` (guard padrão do painel, sem `@Public()`):

```ts
  @Post('phone/start')
  @ApiOperation({ summary: 'Envia código para verificar o WhatsApp do usuário' })
  startPhone(@CurrentUser('id') userId: string, @Body() dto: StartPhoneDto) {
    return this.phoneVerification.iniciar('user', userId, dto.phone);
  }

  @Post('phone/confirm')
  @ApiOperation({ summary: 'Confirma o código e marca o WhatsApp como verificado' })
  confirmPhone(@CurrentUser('id') userId: string, @Body() dto: ConfirmPhoneDto) {
    return this.phoneVerification.confirmar('user', userId, dto.code);
  }
```

Criar os DTOs `StartPhoneDto` (`phone: string`, `@IsString()`, `@Length(10, 20)`) e `ConfirmPhoneDto` (`code: string`, `@Matches(/^\d{6}$/)`) em `backend/src/modules/auth/dto/phone.dto.ts`.

Repetir as duas rotas em `backend/src/modules/tech/tech-auth.controller.ts` com `@Public() @UseGuards(TechnicianJwtGuard)` e `@CurrentTechnician('id')`, passando `'technician'` como mundo.

Em `AuthService.me` e `TechAuthService.me`, acrescentar `phone: true` e `phoneVerifiedAt: true` ao `select` e devolver `phoneVerified: Boolean(registro.phoneVerifiedAt)` no objeto de resposta, mantendo o resto do contrato intacto.

- [ ] **Step 6: Componente do popup**

Criar `frontend/dashboard/src/components/auth/verificar-whatsapp-dialog.tsx`: um `Dialog` do shadcn com `open` fixo em `true`, sem `onOpenChange` e sem botão de fechar, em duas etapas (número → código). Props: `{ onVerificado: () => void; iniciar: (phone: string) => Promise<{ sentTo: string }>; confirmar: (code: string) => Promise<unknown> }` — as funções vêm de fora para o mesmo componente servir painel e PWA. Texto: "Cadastre seu WhatsApp — é por ele que você recupera a senha se esquecer."

- [ ] **Step 7: Ligar no painel e no PWA**

No layout do dashboard (`frontend/dashboard/src/app/(dashboard)/layout.tsx`), depois de carregar o usuário: se `!user.phoneVerified`, renderizar `<VerificarWhatsappDialog ... />` **em vez** do conteúdo das rotas, passando `authApi.startPhone` e `authApi.confirmPhone`.

Em `frontend/dashboard/src/app/tecnico/page.tsx`, no componente raiz, depois do bloco de `me.mustChangePassword`:

```tsx
  if (!me.phoneVerified) {
    return (
      <VerificarWhatsappDialog
        iniciar={techApi.startPhone}
        confirmar={techApi.confirmPhone}
        onVerificado={loadMe}
      />
    );
  }
```

Adicionar `startPhone`/`confirmPhone` a `techApi` e `authApi` seguindo o padrão dos métodos vizinhos, e o campo `phoneVerified: boolean` aos tipos `TechMe` (`frontend/dashboard/src/types/tech.ts`) e `User` (`frontend/dashboard/src/types/`).

- [ ] **Step 8: Conferir tipos e testes**

Run: `cd backend && npx jest src/modules/auth src/modules/tech && cd ../frontend/dashboard && npx tsc --noEmit`
Expected: PASS e sem erros de tipo.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules frontend/dashboard/src
git commit -m "feat(senha): popup obrigatorio de cadastro e verificacao do WhatsApp"
```

---

### Task 7: Verificação completa e deploy

**Files:**
- Modify: nenhum (só execução)

**Interfaces:**
- Consumes: tudo das tasks anteriores.
- Produces: backend e frontend novos em produção, com a migration aplicada.

- [ ] **Step 1: Suíte inteira + tipos + boot**

Run: `cd backend && npx tsc --noEmit && npm test && npx jest src/app-boot.spec.ts`
Expected: tudo verde. `app-boot.spec.ts` é o que prova que o Nest sobe — tsc e testes de unidade passam com o boot quebrado.

- [ ] **Step 2: Aplicar a migration em produção pelo `DIRECT_URL`**

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 \
  "docker exec \$(docker ps -q -f name=backend-rastreamento | head -1) npx prisma migrate deploy"
```

Expected: `Applied migration 20260910120000_senha_por_whatsapp`. A migration é `IF NOT EXISTS` — rodar duas vezes não quebra.

- [ ] **Step 3: Build e push das imagens, uma de cada vez**

Nunca em paralelo: dois builds simultâneos no droplet estouram a memória e derrubam containers em execução.

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 \
  "cd /opt/21go-rastreamento && git pull && \
   docker build -t localhost:5000/backend-rastreamento:latest -f backend/Dockerfile backend && \
   docker push localhost:5000/backend-rastreamento:latest"
```

Depois, só quando o primeiro terminar, o frontend com os build args obrigatórios (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_TRACCAR_URL` — faltar um deixa a baseURL relativa e o painel dá 404 em produção).

- [ ] **Step 4: Atualizar os serviços**

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 \
  "docker service update --force --detach=false --image localhost:5000/backend-rastreamento:latest backend-rastreamento"
```

Swarm puxa do registry interno, não do daemon local — sem o `push` do Step 3 o serviço sobe a imagem velha.

- [ ] **Step 5: Provar que subiu**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://trackgo.site/login
curl -s -o /dev/null -w "%{http_code}\n" https://api.trackgo.site/api/v1/health
curl -s https://api.trackgo.site/api/v1/health | head -c 300
```

Expected: `200` nos dois primeiros. O `/health` mostra `GIT_SHA` — conferir que bate com o commit recém-enviado (no Swarm o valor pode vir fixo; nesse caso confirmar por `docker service ps`).

- [ ] **Step 6: Provar o fluxo de ponta a ponta em produção**

```bash
curl -s -X POST https://api.trackgo.site/api/v1/tech/auth/forgot-password \
  -H "Content-Type: application/json" -d '{"cpf":"00000000000"}'
```

Expected: resposta genérica com `sentTo: null` e HTTP 200 — CPF inexistente não pode revelar nada. Em seguida, com um CPF real de técnico que tenha telefone, conferir que o código chega no WhatsApp.

- [ ] **Step 7: Commit final e push**

```bash
git push origin HEAD
```

---

## Depois deste plano

- **Template AUTHENTICATION na Meta.** Enquanto não existir aprovado na BM `2783265268660874`, `WHATSAPP_PROVIDER=meta` responde `enviado: false` e o usuário vê "não consigo enviar o código agora". O código todo funciona; só a entrega fica pendente. A Evolution API serve de contingência (`WHATSAPP_PROVIDER=evolution`), com número não-oficial.
- **Envs `WHATSAPP_META_*` no EasyPanel** do serviço `backend-rastreamento`. O EasyPanel reescreve o spec do serviço e apaga variáveis adicionadas por CLI — cadastrar pela interface.
- **Popup de telefone no app do associado**, na próxima build de loja.
- **Biometria + sessão de 6 meses no app** — entrega seguinte, já decidida.
