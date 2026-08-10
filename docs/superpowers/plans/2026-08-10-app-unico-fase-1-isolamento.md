# App único, dois mundos — Fase 1: fundação de isolamento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um binário só nas lojas atende associado e time interno, com isolamento criptográfico entre os dois mundos e prova automatizada de que nenhum token cruza a fronteira.

**Architecture:** O backend passa a assinar cada mundo com um segredo próprio e a carimbar `type` em todo JWT; quem não bate é recusado na verificação de assinatura, antes de qualquer lógica. O app ganha uma tela de login única que roteia pelo formato do identificador (CPF → associado, e-mail → interno), dois clientes HTTP isolados com chaves distintas no SecureStore, e um mundo interno que abre o painel real `trackgo.site` dentro de uma WebView com a sessão injetada em `localStorage`, protegida por biometria.

**Tech Stack:** NestJS 11 + Prisma + `@nestjs/jwt` (backend); Expo SDK 54 + expo-router + zustand + `react-native-webview` + `expo-local-authentication` (app); Jest (`jest-expo` no app, `jest` no backend).

## Global Constraints

- **Expo SDK 54.0.35 e `newArchEnabled: false`** — obrigatório. New Architecture trava o boot do JS no iOS 26 (tela branca sem crash). Nunca subir SDK nem ligar New Arch neste plano. Ver [AUDITORIA-TELA-BRANCA.md](../../../mobile/AUDITORIA-TELA-BRANCA.md).
- **Multi-tenant:** toda query nova filtra por `tenantId`. Sem exceção.
- **Soft delete:** models com `deletedAt`; nunca `delete()` físico.
- **Imports do Prisma Client:** usar `.prisma/client`, não `@prisma/client`.
- **Roles em inglês, UI em PT-BR.** Rotas backend em inglês, rotas frontend em PT-BR.
- **Nunca commitar segredo.** `JWT_ASSOCIATE_SECRET` vive no EasyPanel, nunca no repo.
- **Deploy do backend/frontend é sequencial, nunca paralelo** — build paralelo no droplet estoura memória e derruba containers em produção.
- **Deploy exige push pro registry `localhost:5000`** — `docker build` + `service update` sozinho não basta; o Swarm puxa do registry interno.
- **Commits em português**, formato `tipo(escopo): descrição`.

---

## Estrutura de arquivos

**Backend — criar:**
| Arquivo | Responsabilidade |
|---|---|
| `backend/src/config/jwt-guard-rails.ts` | Valida na subida que os dois segredos existem e são diferentes |
| `backend/src/config/jwt-guard-rails.spec.ts` | Testes da validação |
| `backend/src/common/constants/auth-worlds.ts` | Mapa dos três mundos de autenticação e as sondas do leak-check |
| `backend/src/common/constants/auth-worlds.spec.ts` | Varre os controllers e falha se alguém criar rota fora do mapa |
| `backend/src/modules/auth/strategies/jwt.strategy.spec.ts` | Prova que a strategy recusa token de associado |
| `backend/src/modules/app/guards/associate-jwt.guard.spec.ts` | Prova que o guard recusa token interno |
| `backend/scripts/leak-check.ts` | Roda contra a API viva e prova a matriz de vazamento |

**Backend — modificar:**
| Arquivo | Mudança |
|---|---|
| `backend/src/config/configuration.ts` | `jwt.associateSecret`, `jwt.internalExpiration`, `jwt.requireType` |
| `backend/src/main.ts` | Chama a validação antes de subir |
| `backend/src/modules/auth/auth.module.ts` | Passa a usar `jwt.internalExpiration` |
| `backend/src/modules/auth/auth.service.ts` | Payload ganha `type: 'user'` |
| `backend/src/modules/auth/strategies/jwt.strategy.ts` | Recusa `type !== 'user'` |
| `backend/src/modules/app/app-associate.module.ts` | Assina com `jwt.associateSecret` |
| `backend/src/modules/app/guards/associate-jwt.guard.ts` | Verifica com `jwt.associateSecret` |

**App — criar:**
| Arquivo | Responsabilidade |
|---|---|
| `mobile/src/lib/login-router.ts` | Função pura: identificador → mundo de destino |
| `mobile/src/lib/login-router.test.ts` | Testes do roteador |
| `mobile/src/lib/session-keys.ts` | Chaves do SecureStore + invariante de sessão única |
| `mobile/src/lib/session-keys.test.ts` | Testes do invariante |
| `mobile/src/lib/internal-auth-store.ts` | Sessão do mundo interno (zustand + SecureStore) |
| `mobile/src/lib/internal-api.ts` | Cliente HTTP do mundo interno, isolado |
| `mobile/src/lib/biometrics.ts` | Portão biométrico |
| `mobile/src/app/interno/painel.tsx` | WebView do painel com sessão injetada |
| `mobile/src/app/interno/_layout.tsx` | Gate biométrico do mundo interno |

**App — modificar:**
| Arquivo | Mudança |
|---|---|
| `mobile/package.json` | jest-expo, react-native-webview, expo-local-authentication, script `test` |
| `mobile/app.json` | Plugin do local-authentication, bump de versão e build number |
| `mobile/src/app/login.tsx` | Campo único `CPF ou e-mail`, roteia pelo formato |
| `mobile/src/app/_layout.tsx` | Gate de rotas conhece os dois mundos |
| `mobile/src/app/index.tsx` | Boot resolve qual mundo abrir |

---

## Task 1: Segredos separados e validação fail-fast

**Files:**
- Modify: `backend/src/config/configuration.ts:9-12`
- Create: `backend/src/config/jwt-guard-rails.ts`
- Create: `backend/src/config/jwt-guard-rails.spec.ts`
- Modify: `backend/src/main.ts`

**Interfaces:**
- Consumes: nada (primeira tarefa)
- Produces: `assertJwtGuardRails(env: NodeJS.ProcessEnv): void` — lança `Error` se a配置 estiver insegura. Config keys novas: `jwt.associateSecret: string`, `jwt.internalExpiration: string`, `jwt.requireType: boolean`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/src/config/jwt-guard-rails.spec.ts`:

```ts
import { assertJwtGuardRails } from './jwt-guard-rails';

const prodBase = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(32),
  JWT_ASSOCIATE_SECRET: 'b'.repeat(32),
};

describe('assertJwtGuardRails', () => {
  it('aceita produção com dois segredos fortes e distintos', () => {
    expect(() => assertJwtGuardRails(prodBase as any)).not.toThrow();
  });

  it('recusa segredos iguais — seria isolamento de mentira', () => {
    expect(() =>
      assertJwtGuardRails({
        ...prodBase,
        JWT_ASSOCIATE_SECRET: prodBase.JWT_SECRET,
      } as any),
    ).toThrow(/precisam ser diferentes/i);
  });

  it('recusa JWT_ASSOCIATE_SECRET ausente em produção', () => {
    expect(() =>
      assertJwtGuardRails({
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(32),
      } as any),
    ).toThrow(/JWT_ASSOCIATE_SECRET/);
  });

  it('recusa segredo curto em produção', () => {
    expect(() =>
      assertJwtGuardRails({ ...prodBase, JWT_SECRET: 'curto' } as any),
    ).toThrow(/32 caracteres/);
  });

  it('fora de produção tolera ausência, mas ainda exige que os defaults difiram', () => {
    expect(() => assertJwtGuardRails({ NODE_ENV: 'development' } as any)).not.toThrow();
  });

  it('recusa iguais mesmo fora de produção', () => {
    expect(() =>
      assertJwtGuardRails({
        NODE_ENV: 'development',
        JWT_SECRET: 'x',
        JWT_ASSOCIATE_SECRET: 'x',
      } as any),
    ).toThrow(/precisam ser diferentes/i);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd backend && npx jest src/config/jwt-guard-rails.spec.ts
```

Esperado: FAIL com `Cannot find module './jwt-guard-rails'`.

- [ ] **Step 3: Implementar a validação**

Criar `backend/src/config/jwt-guard-rails.ts`:

```ts
/**
 * Trava de configuração dos dois mundos de autenticação.
 *
 * O app é um binário só servindo associado e time interno. O que impede um
 * token de cliente de valer no painel é o segredo de assinatura ser OUTRO —
 * não um `if` em algum lugar. Se alguém apontar as duas variáveis pro mesmo
 * valor, o isolamento vira decoração e ninguém percebe. Por isso o processo
 * recusa subir em vez de logar um aviso que ninguém lê.
 */
const MIN_LENGTH = 32;

export const DEV_INTERNAL_SECRET = 'dev-secret';
export const DEV_ASSOCIATE_SECRET = 'dev-associate-secret';

export function assertJwtGuardRails(env: NodeJS.ProcessEnv): void {
  const isProd = env.NODE_ENV === 'production';
  const internal = env.JWT_SECRET ?? (isProd ? undefined : DEV_INTERNAL_SECRET);
  const associate =
    env.JWT_ASSOCIATE_SECRET ?? (isProd ? undefined : DEV_ASSOCIATE_SECRET);

  if (isProd) {
    if (!internal) throw new Error('JWT_SECRET é obrigatório em produção.');
    if (!associate) {
      throw new Error(
        'JWT_ASSOCIATE_SECRET é obrigatório em produção. Sem ele o token do ' +
          'associado seria verificável no painel interno.',
      );
    }
    if (internal.length < MIN_LENGTH || associate.length < MIN_LENGTH) {
      throw new Error(
        `Os segredos JWT precisam ter ao menos ${MIN_LENGTH} caracteres.`,
      );
    }
  }

  if (internal && associate && internal === associate) {
    throw new Error(
      'JWT_SECRET e JWT_ASSOCIATE_SECRET precisam ser diferentes. Iguais, ' +
        'um token de associado passa a valer no painel interno.',
    );
  }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
cd backend && npx jest src/config/jwt-guard-rails.spec.ts
```

Esperado: PASS, 6 testes.

- [ ] **Step 5: Ligar as chaves novas na configuração**

Em `backend/src/config/configuration.ts`, substituir o bloco `jwt` (linhas 9-12) por:

```ts
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiration: process.env.JWT_EXPIRATION || '24h',
    // Segredo PRÓPRIO do mundo do associado. Diferente do interno de propósito:
    // é o que torna um token de cliente matematicamente inválido no painel.
    associateSecret: process.env.JWT_ASSOCIATE_SECRET || 'dev-associate-secret',
    // Sessão do time interno é mais curta que a do cliente — o celular de quem
    // trabalha carrega o sistema inteiro no bolso.
    internalExpiration: process.env.JWT_INTERNAL_EXPIRATION || '12h',
    // Vira 'true' no segundo deploy, quando todo token legado (sem `type`)
    // já expirou. Antes disso, exigir o campo derrubaria quem está logado.
    requireType: process.env.JWT_REQUIRE_TYPE === 'true',
  },
```

- [ ] **Step 6: Chamar a validação antes de o servidor subir**

Em `backend/src/main.ts`, adicionar o import no topo e a chamada como **primeira linha** de `bootstrap()`:

```ts
import { assertJwtGuardRails } from './config/jwt-guard-rails';

async function bootstrap() {
  assertJwtGuardRails(process.env);
  // ... resto do bootstrap existente, sem alteração
```

- [ ] **Step 7: Confirmar que o backend ainda sobe em dev**

```bash
cd backend && npm run build
```

Esperado: build sem erro de TypeScript.

- [ ] **Step 8: Commit**

```bash
git add backend/src/config/ backend/src/main.ts
git commit -m "feat(auth): segredo JWT próprio do mundo do associado com trava na subida"
```

---

## Task 2: Token tipado nos dois mundos

**Files:**
- Modify: `backend/src/modules/auth/auth.service.ts:70-75`
- Modify: `backend/src/modules/auth/strategies/jwt.strategy.ts`
- Create: `backend/src/modules/auth/strategies/jwt.strategy.spec.ts`
- Modify: `backend/src/modules/app/guards/associate-jwt.guard.ts:43-52`
- Create: `backend/src/modules/app/guards/associate-jwt.guard.spec.ts`

**Interfaces:**
- Consumes: `jwt.requireType` da Task 1.
- Produces: payload do painel passa a ser `{ sub, email, role, tenantId, type: 'user' }`. `JwtStrategy.validate` recusa qualquer `type` diferente de `'user'`. `AssociateJwtGuard` segue recusando `type !== 'associate'`.

- [ ] **Step 1: Escrever o teste que falha na strategy**

Criar `backend/src/modules/auth/strategies/jwt.strategy.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

function build(requireType: boolean, user: any) {
  const config = {
    get: (key: string) =>
      key === 'jwt.secret' ? 'a'.repeat(32) : requireType,
  } as unknown as ConfigService;
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  return new JwtStrategy(config, prisma as any);
}

const ativo = {
  id: 'u1',
  email: 'op@trackgo.site',
  name: 'Operador',
  role: 'OPERATOR',
  tenantId: 't1',
  active: true,
  allowedRoutes: ['mapa'],
};

describe('JwtStrategy', () => {
  it('recusa token de associado mesmo que o sub exista como usuário', async () => {
    const strategy = build(false, ativo);
    await expect(
      strategy.validate({ sub: 'u1', type: 'associate' } as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('aceita token do painel com type user', async () => {
    const strategy = build(false, ativo);
    await expect(
      strategy.validate({ sub: 'u1', type: 'user' } as any),
    ).resolves.toMatchObject({ id: 'u1' });
  });

  it('tolera token legado sem type enquanto requireType está desligado', async () => {
    const strategy = build(false, ativo);
    await expect(strategy.validate({ sub: 'u1' } as any)).resolves.toMatchObject({
      id: 'u1',
    });
  });

  it('recusa token legado sem type depois que requireType é ligado', async () => {
    const strategy = build(true, ativo);
    await expect(strategy.validate({ sub: 'u1' } as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa usuário inativo', async () => {
    const strategy = build(false, { ...ativo, active: false });
    await expect(
      strategy.validate({ sub: 'u1', type: 'user' } as any),
    ).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd backend && npx jest src/modules/auth/strategies/jwt.strategy.spec.ts
```

Esperado: FAIL — o primeiro teste passa um `type: 'associate'` e a strategy atual devolve o usuário em vez de recusar.

- [ ] **Step 3: Implementar a recusa por tipo**

Substituir o conteúdo de `backend/src/modules/auth/strategies/jwt.strategy.ts` por:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tenantId: string;
  /** Ausente só em token legado, emitido antes da separação dos dois mundos. */
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly requireType: boolean;

  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret')!,
    });
    this.requireType = !!configService.get<boolean>('jwt.requireType');
  }

  async validate(payload: JwtPayload) {
    // Barreira de mundo. O segredo separado já deveria ter derrubado um token
    // de associado aqui, mas esta checagem é a segunda camada: se algum dia as
    // duas variáveis de ambiente forem apontadas pro mesmo valor por engano,
    // ainda assim nenhum cliente entra no painel.
    if (payload.type && payload.type !== 'user') {
      throw new UnauthorizedException('Token não pertence ao painel');
    }
    if (this.requireType && payload.type !== 'user') {
      throw new UnauthorizedException('Token sem identificação de origem');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        active: true,
        allowedRoutes: true,
      },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('Usuário não encontrado ou inativo');
    }

    return user;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd backend && npx jest src/modules/auth/strategies/jwt.strategy.spec.ts
```

Esperado: PASS, 5 testes.

- [ ] **Step 5: Emitir `type` no login do painel**

Em `backend/src/modules/auth/auth.service.ts`, trocar o payload (linhas 70-75) por:

```ts
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      type: 'user' as const,
    };
```

- [ ] **Step 6: Escrever o teste do guard do associado**

Criar `backend/src/modules/app/guards/associate-jwt.guard.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { AssociateJwtGuard } from './associate-jwt.guard';

function ctx(token?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    }),
  } as any;
}

function build(payload: any) {
  const jwt = { verify: jest.fn(() => payload) };
  const config = { get: () => 'b'.repeat(32) };
  const prisma = {
    associate: {
      findFirst: jest.fn().mockResolvedValue({ id: 'a1', tenantId: 't1' }),
    },
  };
  return new AssociateJwtGuard(jwt as any, config as any, prisma as any);
}

describe('AssociateJwtGuard', () => {
  it('recusa token do painel', async () => {
    const guard = build({ sub: 'u1', type: 'user' });
    await expect(guard.canActivate(ctx('x'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa token sem type', async () => {
    const guard = build({ sub: 'a1' });
    await expect(guard.canActivate(ctx('x'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('aceita token de associado', async () => {
    const guard = build({ sub: 'a1', type: 'associate', tenantId: 't1' });
    await expect(guard.canActivate(ctx('x'))).resolves.toBe(true);
  });

  it('recusa requisição sem header', async () => {
    const guard = build({ sub: 'a1', type: 'associate' });
    await expect(guard.canActivate(ctx())).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 7: Rodar e ver passar**

```bash
cd backend && npx jest src/modules/app/guards/associate-jwt.guard.spec.ts
```

Esperado: PASS, 4 testes. O guard atual já recusa `type !== 'associate'`, então não precisa mudar o código — este teste **trava** esse comportamento pra ninguém remover sem quebrar a suíte.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/auth backend/src/modules/app/guards
git commit -m "feat(auth): todo JWT carrega type e cada mundo recusa o token do outro"
```

---

## Task 3: Cada mundo assina com o seu segredo

**Files:**
- Modify: `backend/src/modules/app/app-associate.module.ts:18-26`
- Modify: `backend/src/modules/app/guards/associate-jwt.guard.ts:43-48`
- Modify: `backend/src/modules/auth/auth.module.ts:18`

**Interfaces:**
- Consumes: `jwt.associateSecret` e `jwt.internalExpiration` (Task 1); guard já tipado (Task 2).
- Produces: token de associado assinado com `jwt.associateSecret`; token do painel expira em `jwt.internalExpiration`.

- [ ] **Step 1: Trocar o segredo do módulo do associado**

Em `backend/src/modules/app/app-associate.module.ts`, substituir o bloco `JwtModule.registerAsync` por:

```ts
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Segredo PRÓPRIO. Não é o do painel — é isso que torna um token de
        // cliente inválido do outro lado já na verificação da assinatura.
        secret: config.get<string>('jwt.associateSecret')!,
        signOptions: {
          expiresIn: config.get<string>('jwt.expiration')! as any,
        },
      }),
    }),
```

- [ ] **Step 2: Verificar com o mesmo segredo no guard**

Em `backend/src/modules/app/guards/associate-jwt.guard.ts`, trocar a chamada de `verify` (linhas 43-48) por:

```ts
      payload = this.jwt.verify<AssociatePayload>(token, {
        secret: this.config.get<string>('jwt.associateSecret')!,
      });
```

- [ ] **Step 3: Encurtar a sessão do painel**

Em `backend/src/modules/auth/auth.module.ts`, trocar a linha do `expiresIn` por:

```ts
          expiresIn: config.get<string>('jwt.internalExpiration')! as any,
```

- [ ] **Step 4: Rodar a suíte inteira do backend**

```bash
cd backend && npm test
```

Esperado: PASS em tudo, incluindo os specs das Tasks 1 e 2.

- [ ] **Step 5: Provar na mão que os tokens não cruzam**

Subir o backend local (`npm run start:dev`) com `.env` contendo `JWT_SECRET` e `JWT_ASSOCIATE_SECRET` diferentes, e rodar:

```bash
TOKEN_ASSOC=$(curl -s -X POST http://localhost:3001/api/v1/app/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"cpf":"<cpf-de-teste>","password":"<senha>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

curl -s -o /dev/null -w "associado em rota interna: %{http_code}\n" \
  http://localhost:3001/api/v1/devices -H "Authorization: Bearer $TOKEN_ASSOC"
```

Esperado: `associado em rota interna: 401`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/app backend/src/modules/auth/auth.module.ts
git commit -m "feat(auth): mundo do associado assina com segredo próprio e painel expira em 12h"
```

---

## Task 4: Suíte de vazamento que cobre rota nova sozinha

**Files:**
- Create: `backend/src/common/constants/auth-worlds.ts`
- Create: `backend/src/common/constants/auth-worlds.spec.ts`
- Create: `backend/scripts/leak-check.ts`

**Interfaces:**
- Consumes: nada em runtime; o spec lê os controllers do repositório.
- Produces:
  - `INTERNAL_ROUTE_PREFIXES`, `ASSOCIATE_ROUTE_PREFIXES`, `TECHNICIAN_ROUTE_PREFIXES`, `PUBLIC_ROUTE_PREFIXES: readonly string[]`
  - `LEAK_PROBES: readonly LeakProbe[]` onde `LeakProbe = { world: 'internal' | 'associate' | 'technician'; prefix: string; path: string }`

### Por que três mundos, e não dois

Durante a Task 2 descobrimos um terceiro mundo de autenticação que a spec não previa: o **PWA do técnico** (`modules/tech/`), que assina `type: 'technician'` e tem guard próprio (`TechnicianJwtGuard`). Ele já é isolado, mas precisa entrar na matriz — senão a varredura de controllers acusa os controllers dele como órfãos, e um token de associado batendo em `/tech/*` fica sem prova de que é recusado.

Nesta fase o mundo do técnico continua assinando com o segredo do painel (`jwt.secret`). Isso é intencional e está fora do escopo da Fase 1 — o isolamento dele vem do `type` e do guard, não do segredo.

- [ ] **Step 1: Levantar os prefixos reais dos controllers**

O `grep -P` não funciona em toda máquina (falha com `-P supports only unibyte and UTF-8 locales` dependendo do locale). Use o Node, que é portável:

```bash
cd backend && node -e "
const {readdirSync,readFileSync,statSync}=require('fs');const {join}=require('path');
const walk=(d)=>readdirSync(d).flatMap((e)=>{const f=join(d,e);return statSync(f).isDirectory()?walk(f):(e.endsWith('.controller.ts')?[f]:[])});
const achados=walk('src/modules').map((f)=>{const m=readFileSync(f,'utf8').match(/@Controller\(\s*'([^']*)'/);return m?m[1]:null}).filter(Boolean);
console.log([...new Set(achados)].sort().join('\n'));
"
```

Anotar a saída. Ela é a fonte de verdade do Step 2 — **não confie na lista escrita neste plano**, ela pode ter envelhecido. Se a saída divergir do Step 2, a saída ganha.

- [ ] **Step 2: Escrever o mapa dos mundos**

Criar `backend/src/common/constants/auth-worlds.ts`. Os quatro grupos abaixo refletem a varredura de 2026-08-10 — confira contra a saída do Step 1 e ajuste o que tiver mudado:

```ts
/**
 * Mapa dos mundos de autenticação do backend.
 *
 * O projeto atende três públicos com três tipos de token que nunca podem
 * cruzar: o time interno (`type: 'user'`), o cliente final (`type:
 * 'associate'`) e o técnico de campo (`type: 'technician'`). Este arquivo é a
 * fonte única consumida pelo `scripts/leak-check.ts`, e o spec ao lado varre
 * os controllers do repositório e falha se alguém criar rota que não esteja
 * classificada aqui — assim rota nova nasce coberta em vez de nascer furada.
 */

/** Painel do time interno. Token `type: 'user'`. */
export const INTERNAL_ROUTE_PREFIXES: readonly string[] = [
  'admin',
  'admin/audit',
  'alerts',
  'assistant',
  'auth',
  'ble-tags',
  'chips',
  'clients',
  'dashboard',
  'devices',
  'devices/:deviceId/commands',
  'geofences',
  'hinova',
  'installation-pendings',
  'maintenance-plans',
  'map',
  'reports',
  'server',
  'settings',
  'stock',
  'technicians',
  'tenants',
  'traccar',
  'users',
  'vehicles',
];

/** App do cliente final. Token `type: 'associate'`. */
export const ASSOCIATE_ROUTE_PREFIXES: readonly string[] = ['app', 'app/auth'];

/** PWA do técnico de campo. Token `type: 'technician'`. */
export const TECHNICIAN_ROUTE_PREFIXES: readonly string[] = [
  'tech',
  'tech/auth',
];

/**
 * Sem autenticação por desenho. `health` é sondado pelo Docker e pelo
 * monitoramento — exigir token ali derrubaria o healthcheck do container.
 */
export const PUBLIC_ROUTE_PREFIXES: readonly string[] = ['health'];

export type AuthWorld = 'internal' | 'associate' | 'technician';

export interface LeakProbe {
  world: AuthWorld;
  /** Prefixo do controller que esta sonda cobre. */
  prefix: string;
  /** Caminho GET real e existente, que exige autenticação. */
  path: string;
}

/**
 * Caminhos concretos que o `leak-check` dispara. Precisam ser rotas GET que
 * EXISTEM: uma rota inexistente devolve 404 antes de o guard rodar, e 404 de
 * rota inexistente pareceria "protegido" sem nada ter sido protegido.
 */
export const LEAK_PROBES: readonly LeakProbe[] = [
  // Preenchido no Step 3.
];
```

- [ ] **Step 3: Montar as sondas lendo os controllers**

Para **cada** prefixo de `INTERNAL_ROUTE_PREFIXES`, `ASSOCIATE_ROUTE_PREFIXES` e `TECHNICIAN_ROUTE_PREFIXES`, abrir o controller correspondente e escolher **uma rota GET que exista e exija autenticação**. Preencher `LEAK_PROBES` com uma entrada por prefixo.

Regras ao escolher:
- Se o controller só tem POST/PATCH/DELETE, **não invente um GET**. Registre o prefixo numa constante `PROBES_SEM_GET: readonly string[]` no mesmo arquivo, com um comentário dizendo por quê, e deixe-o fora de `LEAK_PROBES`.
- Rota com parâmetro de caminho pode usar um id inexistente (ex.: `/devices/00000000-0000-0000-0000-000000000000/commands`) — o guard roda antes do handler, então o 401 vem primeiro.
- Rota marcada `@Public()` não serve de sonda: ela responde sem token e não prova nada. Se o prefixo inteiro só tiver rotas públicas, ele vai pra `PROBES_SEM_GET`.

- [ ] **Step 4: Escrever o teste que varre os controllers**

Criar `backend/src/common/constants/auth-worlds.spec.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  ASSOCIATE_ROUTE_PREFIXES,
  INTERNAL_ROUTE_PREFIXES,
  LEAK_PROBES,
  PROBES_SEM_GET,
  PUBLIC_ROUTE_PREFIXES,
  TECHNICIAN_ROUTE_PREFIXES,
} from './auth-worlds';

const MODULES_DIR = join(__dirname, '..', '..', 'modules');

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return entry.endsWith('.controller.ts') ? [full] : [];
  });
}

function prefixOf(file: string): string | null {
  const match = readFileSync(file, 'utf8').match(/@Controller\(\s*'([^']*)'/);
  return match ? match[1] : null;
}

const TODOS_OS_MUNDOS = [
  ...INTERNAL_ROUTE_PREFIXES,
  ...ASSOCIATE_ROUTE_PREFIXES,
  ...TECHNICIAN_ROUTE_PREFIXES,
  ...PUBLIC_ROUTE_PREFIXES,
];

describe('mapa dos mundos de autenticação', () => {
  const prefixos = controllerFiles(MODULES_DIR)
    .map((file) => ({ file, prefix: prefixOf(file) }))
    .filter((c): c is { file: string; prefix: string } => c.prefix !== null);

  it('todo controller está classificado em exatamente um mundo', () => {
    const naoClassificados = prefixos
      .filter(({ prefix }) => !TODOS_OS_MUNDOS.includes(prefix))
      .map(({ prefix, file }) => `${prefix} (${file})`);

    expect(naoClassificados).toEqual([]);
  });

  it('nenhum prefixo aparece em mais de um mundo', () => {
    const vistos = new Map<string, number>();
    for (const p of TODOS_OS_MUNDOS) {
      vistos.set(p, (vistos.get(p) ?? 0) + 1);
    }
    const duplicados = [...vistos.entries()]
      .filter(([, n]) => n > 1)
      .map(([p]) => p);

    expect(duplicados).toEqual([]);
  });

  it('todo prefixo com autenticação tem sonda ou justificativa registrada', () => {
    const comAuth = [
      ...INTERNAL_ROUTE_PREFIXES,
      ...ASSOCIATE_ROUTE_PREFIXES,
      ...TECHNICIAN_ROUTE_PREFIXES,
    ];
    const cobertos = new Set([
      ...LEAK_PROBES.map((s) => s.prefix),
      ...PROBES_SEM_GET,
    ]);
    const semCobertura = comAuth.filter((p) => !cobertos.has(p));

    expect(semCobertura).toEqual([]);
  });

  it('cada sonda aponta pro mundo do próprio prefixo', () => {
    const mundoDe = (prefix: string) =>
      INTERNAL_ROUTE_PREFIXES.includes(prefix)
        ? 'internal'
        : ASSOCIATE_ROUTE_PREFIXES.includes(prefix)
          ? 'associate'
          : 'technician';

    const errados = LEAK_PROBES.filter((s) => s.world !== mundoDe(s.prefix)).map(
      (s) => `${s.prefix} declarado como ${s.world}`,
    );

    expect(errados).toEqual([]);
  });
});
```

- [ ] **Step 5: Rodar e ajustar até passar**

```bash
cd backend && npx jest src/common/constants/auth-worlds.spec.ts
```

Esperado: PASS, 4 testes. Cada falha imprime exatamente o que ficou de fora — acrescentar ao grupo certo e rodar de novo. **Não relaxe a asserção pra fazer o teste passar**; o valor do teste está justamente em ele reclamar.

- [ ] **Step 6: Escrever o verificador contra a API viva**

Criar `backend/scripts/leak-check.ts`:

```ts
/**
 * Prova, contra a API DE VERDADE, que nenhum token cruza a fronteira dos três
 * mundos de autenticação. Roda antes de cada deploy.
 *
 *   npx ts-node scripts/leak-check.ts
 *
 * Variáveis:
 *   LEAK_API_URL     base da API (default https://api.trackgo.site/api/v1)
 *   LEAK_CPF         CPF de um associado de teste
 *   LEAK_CPF_PASS    senha dele
 *   LEAK_EMAIL       e-mail de um usuário interno de teste
 *   LEAK_EMAIL_PASS  senha dele
 */
import { LEAK_PROBES } from '../src/common/constants/auth-worlds';

const API = process.env.LEAK_API_URL || 'https://api.trackgo.site/api/v1';

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Falta a variável ${nome}.`);
    process.exit(1);
  }
  return valor;
}

async function login(path: string, body: unknown): Promise<string> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  const token = json?.data?.accessToken ?? json?.accessToken;
  if (!token) {
    console.error(`Login falhou em ${path}: HTTP ${res.status}`);
    process.exit(1);
  }
  return token;
}

async function status(path: string, token: string): Promise<number> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status;
}

/**
 * 401 e 403 são recusa. 404 é ambíguo — pode ser guard recusando ou rota que
 * não existe — e por isso conta como FALHA aqui: sonda que não prova nada não
 * pode passar por prova.
 */
function recusou(code: number): boolean {
  return code === 401 || code === 403;
}

async function main() {
  const cpf = exigir('LEAK_CPF');
  const cpfPass = exigir('LEAK_CPF_PASS');
  const email = exigir('LEAK_EMAIL');
  const emailPass = exigir('LEAK_EMAIL_PASS');

  const associado = await login('/app/auth/login', { cpf, password: cpfPass });
  const interno = await login('/auth/login', { email, password: emailPass });

  const falhas: string[] = [];

  async function conferir(
    rotulo: string,
    token: string,
    path: string,
  ): Promise<void> {
    const code = await status(path, token);
    const ok = recusou(code);
    console.log(`${rotulo} -> ${path}: ${code} ${ok ? 'OK' : 'VAZOU'}`);
    if (!ok) falhas.push(`${rotulo} recebeu ${code} em ${path}`);
  }

  // Token de associado não pode tocar em NADA fora do mundo dele.
  for (const sonda of LEAK_PROBES) {
    if (sonda.world === 'associate') continue;
    await conferir('associado', associado, sonda.path);
  }

  // Token interno não pode tocar no mundo do cliente nem no do técnico.
  for (const sonda of LEAK_PROBES) {
    if (sonda.world === 'internal') continue;
    await conferir('interno', interno, sonda.path);
  }

  // Assinatura adulterada tem que morrer na verificação.
  await conferir('token adulterado', `${interno}x`, '/devices');

  if (falhas.length) {
    console.error('\nVAZAMENTO DETECTADO:\n' + falhas.join('\n'));
    process.exit(1);
  }
  console.log(`\n${LEAK_PROBES.length} sondas conferidas. Fronteira intacta.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 7: Conferir que o script compila**

Não há backend local nem credenciais nesta máquina, então o script **não roda** aqui — a execução real acontece na Task 5, contra produção. O que dá pra provar agora é que ele compila e que as sondas estão coerentes:

```bash
cd backend && npx tsc --noEmit -p tsconfig.json
```

Esperado: nenhum erro. Se `scripts/` estiver fora do `include` do tsconfig, rodar `npx tsc --noEmit scripts/leak-check.ts --esModuleInterop --target es2021 --module commonjs --moduleResolution node` e registrar qual comando foi usado.

- [ ] **Step 8: Rodar a suíte completa**

```bash
cd backend && npm test
```

Esperado: tudo passando, saída limpa.

- [ ] **Step 9: Commit**

```bash
git add backend/src/common/constants backend/scripts/leak-check.ts
git commit -m "test(auth): mapa dos três mundos de autenticação e suíte de vazamento"
```

## Task 5: Deploy A do backend e validação em produção

**Files:** nenhum arquivo novo — deploy e verificação.

**Interfaces:**
- Consumes: Tasks 1-4 completas.
- Produces: produção rodando com segredos separados e `JWT_REQUIRE_TYPE=false`.

- [ ] **Step 1: Baseline antes de mexer**

```bash
curl -s -o /dev/null -w "dashboard: %{http_code}\n" https://trackgo.site/login
curl -s -o /dev/null -w "api: %{http_code}\n" https://api.trackgo.site/api/v1/health
```

Esperado: `200` nos dois. Se não for 200, **parar** — restaurar produção é prioridade sobre qualquer feature.

- [ ] **Step 2: Gerar e cadastrar o segredo novo**

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Cadastrar a saída como `JWT_ASSOCIATE_SECRET` nas env vars do serviço `backend-rastreamento` no EasyPanel. Cadastrar também `JWT_INTERNAL_EXPIRATION=12h` e `JWT_REQUIRE_TYPE=false`. **Não commitar o valor.**

- [ ] **Step 3: Build e push da imagem**

Build sequencial (nunca em paralelo com o frontend — estoura memória do droplet e derruba containers):

```bash
ssh <droplet> 'cd /caminho/backend && docker build -t localhost:5000/backend-rastreamento:latest . && docker push localhost:5000/backend-rastreamento:latest'
```

- [ ] **Step 4: Atualizar o serviço**

```bash
ssh <droplet> 'docker service update --force --image localhost:5000/backend-rastreamento:latest backend-rastreamento'
```

- [ ] **Step 5: Verificar que subiu (a trava da Task 1 recusa segredo mal configurado)**

```bash
curl -s -o /dev/null -w "api: %{http_code}\n" https://api.trackgo.site/api/v1/health
curl -s -o /dev/null -w "dashboard: %{http_code}\n" https://trackgo.site/login
```

Esperado: `200` nos dois. Se a API não subir, checar `docker service logs backend-rastreamento` — a mensagem da trava diz exatamente qual variável está errada.

- [ ] **Step 6: Rodar a suíte de vazamento contra produção**

```bash
cd backend && LEAK_CPF=<cpf-teste> LEAK_CPF_PASS=<senha> \
  LEAK_EMAIL=<email-teste> LEAK_EMAIL_PASS=<senha> \
  npx ts-node scripts/leak-check.ts
```

Esperado: `Nenhum vazamento. Fronteira intacta.`

- [ ] **Step 7: Confirmar que o app publicado nas lojas continua funcionando**

O app em produção tem token assinado com o segredo **antigo**. Com a troca, ele recebe 401 e cai no login — comportamento esperado e aceitável (o usuário loga de novo). Confirmar na prática:

```bash
curl -s -X POST https://api.trackgo.site/api/v1/app/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"cpf":"<cpf-teste>","password":"<senha>"}' -o /dev/null -w "login associado: %{http_code}\n"
```

Esperado: `201`. Anotar no log da sessão que os associados logados foram deslogados uma vez.

- [ ] **Step 8: Agendar o Deploy B**

Anotar: **daqui a 24h**, trocar `JWT_REQUIRE_TYPE` pra `true` no EasyPanel e reiniciar o serviço. Nesse momento todo token legado sem `type` já expirou. Repetir os Steps 5 e 6 depois da troca.

---

## Task 6: Infra de teste no app

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/tsconfig.json`

**Interfaces:**
- Consumes: nada.
- Produces: `npm test` funcionando no diretório `mobile/`, preset `jest-expo`.

- [ ] **Step 1: Instalar**

```bash
cd mobile && npx expo install jest-expo jest @types/jest -- --dev
```

- [ ] **Step 2: Configurar o preset**

Em `mobile/package.json`, adicionar `"test": "jest"` em `scripts` e o bloco no nível raiz:

```json
  "jest": {
    "preset": "jest-expo"
  }
```

Em `mobile/tsconfig.json`, acrescentar em `compilerOptions`:

```json
    "types": ["jest"]
```

- [ ] **Step 3: Provar que o runner roda**

Criar `mobile/src/lib/smoke.test.ts`:

```ts
it('o runner de teste está de pé', () => {
  expect(1 + 1).toBe(2);
});
```

```bash
cd mobile && npm test
```

Esperado: PASS, 1 teste.

- [ ] **Step 4: Remover o smoke e commitar**

```bash
rm mobile/src/lib/smoke.test.ts
git add mobile/package.json mobile/package-lock.json mobile/tsconfig.json
git commit -m "chore(mobile): jest-expo pra testar as regras de sessão do app"
```

---

## Task 7: Roteador de login e invariante de sessão única

**Files:**
- Create: `mobile/src/lib/login-router.ts`
- Create: `mobile/src/lib/login-router.test.ts`
- Create: `mobile/src/lib/session-keys.ts`
- Create: `mobile/src/lib/session-keys.test.ts`

**Interfaces:**
- Consumes: infra de teste da Task 6.
- Produces:
  - `resolveLoginTarget(input: string): 'associate' | 'internal' | 'invalid'`
  - `ASSOCIATE_TOKEN_KEY`, `INTERNAL_TOKEN_KEY`, `ASSOCIATE_NAME_KEY`, `ASSOCIATE_MUST_CHANGE_KEY`, `INTERNAL_USER_KEY: string`
  - `resolveBootWorld(associateToken: string | null, internalToken: string | null): 'associate' | 'internal' | 'none'`

- [ ] **Step 1: Escrever os testes do roteador**

Criar `mobile/src/lib/login-router.test.ts`:

```ts
import { resolveLoginTarget } from './login-router';

describe('resolveLoginTarget', () => {
  it('CPF com máscara vai pro mundo do associado', () => {
    expect(resolveLoginTarget('085.775.907-80')).toBe('associate');
  });

  it('CPF só com dígitos vai pro mundo do associado', () => {
    expect(resolveLoginTarget('08577590780')).toBe('associate');
  });

  it('e-mail vai pro mundo interno', () => {
    expect(resolveLoginTarget('operador@trackgo.site')).toBe('internal');
  });

  it('espaços em volta não confundem', () => {
    expect(resolveLoginTarget('  operador@trackgo.site ')).toBe('internal');
  });

  it('CPF incompleto é inválido — não chega a bater na API', () => {
    expect(resolveLoginTarget('0857759')).toBe('invalid');
  });

  it('texto solto sem arroba é inválido', () => {
    expect(resolveLoginTarget('joao')).toBe('invalid');
  });

  it('vazio é inválido', () => {
    expect(resolveLoginTarget('')).toBe('invalid');
  });

  it('e-mail ganha do formato numérico se tiver arroba', () => {
    expect(resolveLoginTarget('08577590780@trackgo.site')).toBe('internal');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd mobile && npm test -- login-router
```

Esperado: FAIL com `Cannot find module './login-router'`.

- [ ] **Step 3: Implementar o roteador**

Criar `mobile/src/lib/login-router.ts`:

```ts
/**
 * Decide, ANTES de qualquer chamada de rede, pra qual mundo o login vai.
 *
 * Associado entra por CPF; time interno entra por e-mail. A decisão é local de
 * propósito: se o app perguntasse ao servidor "esse identificador é de quem?",
 * qualquer pessoa com o app na mão teria um verificador de quais e-mails
 * pertencem ao time — primeiro passo de ataque dirigido.
 */
export type LoginTarget = 'associate' | 'internal' | 'invalid';

export function resolveLoginTarget(input: string): LoginTarget {
  const valor = (input || '').trim();
  if (valor.length === 0) return 'invalid';
  // Arroba manda: e-mail é sempre mundo interno, mesmo que comece com números.
  if (valor.includes('@')) return 'internal';
  const digitos = valor.replace(/\D/g, '');
  // Só aceita como CPF o que é de fato número e máscara — "joao123" não passa.
  if (digitos.length === 11 && /^[\d.\-\s]+$/.test(valor)) return 'associate';
  return 'invalid';
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd mobile && npm test -- login-router
```

Esperado: PASS, 8 testes.

- [ ] **Step 5: Escrever os testes do invariante de sessão**

Criar `mobile/src/lib/session-keys.test.ts`:

```ts
import {
  ASSOCIATE_TOKEN_KEY,
  INTERNAL_TOKEN_KEY,
  resolveBootWorld,
} from './session-keys';

describe('resolveBootWorld', () => {
  it('só token de associado abre o mundo do associado', () => {
    expect(resolveBootWorld('tok', null)).toBe('associate');
  });

  it('só token interno abre o mundo interno', () => {
    expect(resolveBootWorld(null, 'tok')).toBe('internal');
  });

  it('nenhum token cai no login', () => {
    expect(resolveBootWorld(null, null)).toBe('none');
  });

  it('os dois presentes é estado impossível: cai no login (fail closed)', () => {
    expect(resolveBootWorld('a', 'b')).toBe('none');
  });

  it('as chaves dos dois mundos são diferentes', () => {
    expect(ASSOCIATE_TOKEN_KEY).not.toBe(INTERNAL_TOKEN_KEY);
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

```bash
cd mobile && npm test -- session-keys
```

Esperado: FAIL com `Cannot find module './session-keys'`.

- [ ] **Step 7: Implementar**

Criar `mobile/src/lib/session-keys.ts`:

```ts
/**
 * Chaves do SecureStore e a regra de qual mundo abrir no boot.
 *
 * Cada mundo tem chave própria: não existe "o token" genérico no app. Uma tela
 * do associado é incapaz de montar uma requisição interna porque não alcança a
 * chave que guarda aquele token.
 */
export const ASSOCIATE_TOKEN_KEY = 'r21go.associate.token';
export const ASSOCIATE_NAME_KEY = 'r21go.associate.name';
export const ASSOCIATE_MUST_CHANGE_KEY = 'r21go.associate.mustChangePassword';

export const INTERNAL_TOKEN_KEY = 'r21go.internal.token';
export const INTERNAL_USER_KEY = 'r21go.internal.user';

export type World = 'associate' | 'internal' | 'none';

/**
 * Só pode existir UMA sessão viva. Os dois tokens presentes ao mesmo tempo é
 * estado impossível — pode ser bug nosso ou adulteração do armazenamento. Nos
 * dois casos a resposta é a mesma: não abre nada, manda pro login. Quem tenta
 * adivinhar a intenção nesse ponto é quem vaza dado.
 */
export function resolveBootWorld(
  associateToken: string | null,
  internalToken: string | null,
): World {
  if (associateToken && internalToken) return 'none';
  if (internalToken) return 'internal';
  if (associateToken) return 'associate';
  return 'none';
}
```

- [ ] **Step 8: Rodar e ver passar**

```bash
cd mobile && npm test
```

Esperado: PASS, 13 testes no total.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/lib/login-router.ts mobile/src/lib/login-router.test.ts \
        mobile/src/lib/session-keys.ts mobile/src/lib/session-keys.test.ts
git commit -m "feat(mobile): roteador de login por formato e invariante de sessão única"
```

---

## Task 8: Sessão e cliente HTTP do mundo interno

**Files:**
- Create: `mobile/src/lib/internal-auth-store.ts`
- Create: `mobile/src/lib/internal-api.ts`
- Modify: `mobile/src/lib/auth-store.ts:5-7`

**Interfaces:**
- Consumes: chaves e `resolveBootWorld` da Task 7.
- Produces:
  - `useInternalAuth` (zustand) com `{ token, user, hydrated, hydrate(), signIn(token, user), logout() }` onde `user: InternalUser | null`
  - `InternalUser = { id: string; name: string; email: string; role: string; allowedRoutes: string[] }`
  - `InternalApi.login(email, password): Promise<{ accessToken: string; user: InternalUser }>`

- [ ] **Step 1: Reaproveitar as chaves no store do associado**

Em `mobile/src/lib/auth-store.ts`, trocar as três constantes locais (linhas 5-7) por um import:

```ts
import {
  ASSOCIATE_TOKEN_KEY as TOKEN_KEY,
  ASSOCIATE_NAME_KEY as NAME_KEY,
  ASSOCIATE_MUST_CHANGE_KEY as MUST_CHANGE_KEY,
} from './session-keys';
```

Nenhuma outra linha do arquivo muda — os nomes locais continuam iguais.

- [ ] **Step 2: Criar o store da sessão interna**

Criar `mobile/src/lib/internal-auth-store.ts`:

```ts
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import {
  ASSOCIATE_MUST_CHANGE_KEY,
  ASSOCIATE_NAME_KEY,
  ASSOCIATE_TOKEN_KEY,
  INTERNAL_TOKEN_KEY,
  INTERNAL_USER_KEY,
} from './session-keys';

export interface InternalUser {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Telas que este usuário pode ver. Vazio = todas as do perfil dele. */
  allowedRoutes: string[];
}

interface InternalAuthState {
  token: string | null;
  user: InternalUser | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  signIn: (token: string, user: InternalUser) => Promise<void>;
  logout: () => Promise<void>;
}

/** Apaga qualquer resquício do mundo do associado. Uma sessão viva por vez. */
async function wipeAssociateSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(ASSOCIATE_TOKEN_KEY),
    SecureStore.deleteItemAsync(ASSOCIATE_NAME_KEY),
    SecureStore.deleteItemAsync(ASSOCIATE_MUST_CHANGE_KEY),
  ]);
}

export const useInternalAuth = create<InternalAuthState>((set) => ({
  token: null,
  user: null,
  hydrated: false,

  hydrate: async () => {
    // Mesmo failsafe do store do associado: SecureStore travado no iPhone não
    // pode prender o app numa tela de carregamento eterna.
    const failsafe = setTimeout(() => {
      if (!useInternalAuth.getState().hydrated) {
        set({ token: null, user: null, hydrated: true });
      }
    }, 4000);
    try {
      const [token, rawUser] = await Promise.all([
        SecureStore.getItemAsync(INTERNAL_TOKEN_KEY),
        SecureStore.getItemAsync(INTERNAL_USER_KEY),
      ]);
      clearTimeout(failsafe);
      set({
        token,
        user: rawUser ? (JSON.parse(rawUser) as InternalUser) : null,
        hydrated: true,
      });
    } catch {
      clearTimeout(failsafe);
      set({ token: null, user: null, hydrated: true });
    }
  },

  signIn: async (token, user) => {
    // Entrar num mundo apaga o outro — invariante de sessão única.
    await wipeAssociateSession();
    await Promise.all([
      SecureStore.setItemAsync(INTERNAL_TOKEN_KEY, token),
      SecureStore.setItemAsync(INTERNAL_USER_KEY, JSON.stringify(user)),
    ]);
    set({ token, user });
  },

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(INTERNAL_TOKEN_KEY),
      SecureStore.deleteItemAsync(INTERNAL_USER_KEY),
    ]);
    set({ token: null, user: null });
  },
}));
```

- [ ] **Step 3: Criar o cliente HTTP isolado**

Criar `mobile/src/lib/internal-api.ts`:

```ts
import axios from 'axios';
import Constants from 'expo-constants';
import { useInternalAuth, InternalUser } from './internal-auth-store';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
  'https://api.trackgo.site/api/v1';

/**
 * Cliente do MUNDO INTERNO. Instância separada da do associado de propósito:
 * cada uma só conhece o próprio token, então nenhuma tela consegue, nem por
 * engano, mandar credencial de um mundo pro endpoint do outro.
 */
export const internalApi = axios.create({ baseURL: API_URL, timeout: 15000 });

internalApi.interceptors.request.use((config) => {
  const token = useInternalAuth.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

internalApi.interceptors.response.use(
  (r) => {
    const body: unknown = r.data;
    if (body && typeof body === 'object' && 'data' in body) {
      r.data = (body as { data: unknown }).data;
    }
    return r;
  },
  async (error) => {
    if (error?.response?.status === 401) {
      await useInternalAuth.getState().logout();
    }
    return Promise.reject(error);
  },
);

export const InternalApi = {
  login: (email: string, password: string) =>
    internalApi
      .post<{ accessToken: string; user: InternalUser }>('/auth/login', {
        email,
        password,
      })
      .then((r) => r.data),
};
```

- [ ] **Step 4: Verificar tipos**

```bash
cd mobile && npx tsc --noEmit
```

Esperado: nenhum erro.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/internal-auth-store.ts mobile/src/lib/internal-api.ts mobile/src/lib/auth-store.ts
git commit -m "feat(mobile): sessão e cliente HTTP isolados do mundo interno"
```

---

## Task 9: Portão biométrico

**Files:**
- Create: `mobile/src/lib/biometrics.ts`
- Modify: `mobile/app.json`

**Interfaces:**
- Consumes: nada.
- Produces: `requestUnlock(): Promise<'granted' | 'denied' | 'unavailable'>` e `shouldRelock(lastActiveAt: number | null, now: number): boolean`.

- [ ] **Step 1: Instalar**

```bash
cd mobile && npx expo install expo-local-authentication
```

- [ ] **Step 2: Declarar o plugin**

Em `mobile/app.json`, dentro de `expo.plugins`, acrescentar:

```json
      [
        "expo-local-authentication",
        {
          "faceIDPermission": "Use o Face ID para abrir o painel de trabalho da 21 GO."
        }
      ]
```

- [ ] **Step 3: Escrever o teste da regra de re-bloqueio**

Criar `mobile/src/lib/biometrics.test.ts`:

```ts
import { RELOCK_AFTER_MS, shouldRelock } from './biometrics';

describe('shouldRelock', () => {
  const agora = 1_000_000_000;

  it('sem registro de atividade, bloqueia', () => {
    expect(shouldRelock(null, agora)).toBe(true);
  });

  it('voltou em menos de 5 minutos: não pede de novo', () => {
    expect(shouldRelock(agora - 60_000, agora)).toBe(false);
  });

  it('voltou depois de 5 minutos: pede biometria', () => {
    expect(shouldRelock(agora - RELOCK_AFTER_MS - 1, agora)).toBe(true);
  });

  it('exatamente no limite ainda não pede', () => {
    expect(shouldRelock(agora - RELOCK_AFTER_MS, agora)).toBe(false);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

```bash
cd mobile && npm test -- biometrics
```

Esperado: FAIL com `Cannot find module './biometrics'`.

- [ ] **Step 5: Implementar**

Criar `mobile/src/lib/biometrics.ts`:

```ts
import * as LocalAuthentication from 'expo-local-authentication';

/** Cinco minutos parado e o painel de trabalho pede a digital de novo. */
export const RELOCK_AFTER_MS = 5 * 60 * 1000;

export function shouldRelock(lastActiveAt: number | null, now: number): boolean {
  if (lastActiveAt === null) return true;
  return now - lastActiveAt > RELOCK_AFTER_MS;
}

export type UnlockResult = 'granted' | 'denied' | 'unavailable';

/**
 * Portão do mundo interno.
 *
 * `disableDeviceFallback: false` de propósito: aparelho sem digital cadastrada
 * cai no PIN do sistema em vez de ficar sem trava nenhuma. Quando não há nem
 * hardware nem PIN, devolvemos 'unavailable' — e quem chama exige a senha do
 * painel. Em nenhum caminho existe "entrar sem provar nada".
 */
export async function requestUnlock(): Promise<UnlockResult> {
  const temHardware = await LocalAuthentication.hasHardwareAsync();
  const temCadastro = await LocalAuthentication.isEnrolledAsync();
  if (!temHardware && !temCadastro) return 'unavailable';

  const resultado = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Confirme que é você para abrir o painel de trabalho',
    cancelLabel: 'Cancelar',
    disableDeviceFallback: false,
  });

  return resultado.success ? 'granted' : 'denied';
}
```

- [ ] **Step 6: Rodar e ver passar**

```bash
cd mobile && npm test
```

Esperado: PASS, 17 testes no total.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/lib/biometrics.ts mobile/src/lib/biometrics.test.ts mobile/app.json mobile/package.json mobile/package-lock.json
git commit -m "feat(mobile): portão biométrico do mundo interno com fallback pro PIN"
```

---

## Task 10: Tela de login unificada

**Files:**
- Modify: `mobile/src/app/login.tsx`

**Interfaces:**
- Consumes: `resolveLoginTarget` (Task 7), `useInternalAuth` + `InternalApi` (Task 8), `AppApi` + `useAuth` (existentes).
- Produces: tela única que chama `/app/auth/login` ou `/auth/login` conforme o formato.

- [ ] **Step 1: Trocar o cabeçalho de imports e o corpo do componente**

Em `mobile/src/app/login.tsx`, substituir os imports do bloco `@/lib` e todo o corpo de `LoginScreen` até o fim de `handleLogin`, mantendo o JSX abaixo (que será ajustado no Step 2):

```ts
import { AppApi } from '@/lib/api';
import { InternalApi } from '@/lib/internal-api';
import { useAuth } from '@/lib/auth-store';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { resolveLoginTarget } from '@/lib/login-router';
import { maskCpf, onlyDigits } from '@/lib/format';
import { colors, radii } from '@/lib/theme';
import { diag } from '@/lib/diag';

export default function LoginScreen() {
  diag('05-login-render');
  const router = useRouter();
  const signInAssociado = useAuth((s) => s.signIn);
  const signInInterno = useInternalAuth((s) => s.signIn);
  const [identificador, setIdentificador] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const destino = resolveLoginTarget(identificador);
  const canSubmit = destino !== 'invalid' && password.length >= 6;

  /**
   * Máscara de CPF só enquanto o texto for numérico. No instante em que o
   * usuário digita uma letra ou arroba, o campo vira e-mail e para de mascarar.
   */
  function handleChange(texto: string) {
    const pareceCpf = /^[\d.\-\s]*$/.test(texto);
    setIdentificador(pareceCpf ? maskCpf(texto) : texto);
  }

  async function handleLogin() {
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      if (destino === 'associate') {
        const { accessToken, associate } = await AppApi.login(
          onlyDigits(identificador),
          password,
        );
        await signInAssociado(
          accessToken,
          associate.name,
          associate.mustChangePassword ?? false,
        );
      } else {
        const { accessToken, user } = await InternalApi.login(
          identificador.trim(),
          password,
        );
        await signInInterno(accessToken, user);
        router.replace('/interno/painel');
      }
    } catch {
      // Mensagem IDÊNTICA nos dois caminhos. Se variasse, o app viraria um
      // verificador de quais e-mails pertencem ao time — e uma lista dessas é
      // o primeiro passo de qualquer ataque dirigido.
      RNAlert.alert(
        'Não foi possível entrar',
        'CPF/e-mail ou senha inválidos. Confira e tente de novo.',
      );
    } finally {
      setLoading(false);
    }
  }
```

- [ ] **Step 2: Ajustar o JSX do campo**

No mesmo arquivo, trocar o bloco do campo CPF (o `<View style={styles.field}>` que contém o `TextInput` de CPF) por:

```tsx
          <View style={styles.field}>
            <Text style={styles.label}>CPF ou e-mail</Text>
            <TextInput
              value={identificador}
              onChangeText={handleChange}
              placeholder="000.000.000-00"
              placeholderTextColor={colors.textFaint}
              keyboardType="default"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              maxLength={80}
              autoComplete="off"
            />
          </View>
```

- [ ] **Step 3: Verificar tipos**

```bash
cd mobile && npx tsc --noEmit
```

Esperado: nenhum erro. Se acusar `router` sem uso, conferir que o import de `useRouter` continua no topo.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/app/login.tsx
git commit -m "feat(mobile): login único que roteia associado e time interno pelo formato"
```

---

## Task 11: Painel embarcado com sessão injetada

**Files:**
- Create: `mobile/src/app/interno/_layout.tsx`
- Create: `mobile/src/app/interno/painel.tsx`

**Interfaces:**
- Consumes: `useInternalAuth` (Task 8), `requestUnlock` + `shouldRelock` (Task 9).
- Produces: rota `/interno/painel`.

- [ ] **Step 1: Instalar a WebView**

```bash
cd mobile && npx expo install react-native-webview
```

- [ ] **Step 2: Criar o gate biométrico do mundo interno**

Criar `mobile/src/app/interno/_layout.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { AppState, View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { requestUnlock, shouldRelock } from '@/lib/biometrics';
import { colors } from '@/lib/theme';

const MAX_TENTATIVAS = 3;

export default function InternoLayout() {
  const router = useRouter();
  const { token, logout } = useInternalAuth();
  const [liberado, setLiberado] = useState(false);
  const ultimaAtividade = useRef<number | null>(null);
  const tentativas = useRef(0);

  async function desbloquear() {
    const r = await requestUnlock();
    if (r === 'granted') {
      tentativas.current = 0;
      ultimaAtividade.current = Date.now();
      setLiberado(true);
      return;
    }
    if (r === 'unavailable') {
      // Sem biometria e sem PIN no aparelho não existe "entrar assim mesmo":
      // derruba a sessão e obriga a senha do painel de novo.
      await logout();
      router.replace('/login');
      return;
    }
    tentativas.current += 1;
    if (tentativas.current >= MAX_TENTATIVAS) {
      await logout();
      router.replace('/login');
    }
  }

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    desbloquear();
  }, [token]);

  // Voltou do background depois de 5 minutos parado: pede de novo.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'background') {
        ultimaAtividade.current = Date.now();
        setLiberado(false);
        return;
      }
      if (estado === 'active' && !liberado) {
        if (shouldRelock(ultimaAtividade.current, Date.now())) {
          desbloquear();
        } else {
          setLiberado(true);
        }
      }
    });
    return () => sub.remove();
  }, [liberado]);

  if (!liberado) {
    return (
      <View style={styles.gate}>
        <ActivityIndicator size="large" color={colors.orange} />
        <Text style={styles.texto}>Confirme que é você para continuar</Text>
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
    gap: 16,
  },
  texto: { color: colors.white, fontSize: 15 },
});
```

- [ ] **Step 3: Criar a tela do painel**

Criar `mobile/src/app/interno/painel.tsx`:

```tsx
import { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { colors } from '@/lib/theme';

const PAINEL_ORIGIN = 'https://trackgo.site';

export default function PainelInterno() {
  const router = useRouter();
  const { token, user, logout } = useInternalAuth();
  const webRef = useRef<WebView>(null);

  /**
   * O painel lê a sessão de `localStorage.token` (frontend/dashboard/src/lib/api.ts).
   * Escrevemos antes do primeiro script da página rodar, então ele abre já
   * logado — o funcionário digita a senha uma vez, no app, e nunca dentro da web.
   */
  const injecao = `
    (function () {
      try {
        localStorage.setItem('token', ${JSON.stringify(token ?? '')});
        localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user ?? null))});
      } catch (e) {}
    })();
    true;
  `;

  async function sair() {
    await logout();
    router.replace('/login');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.barra}>
        <Text style={styles.nome} numberOfLines={1}>
          {user?.name ?? 'Painel'}
        </Text>
        <TouchableOpacity onPress={sair} hitSlop={12}>
          <Text style={styles.sair}>Sair</Text>
        </TouchableOpacity>
      </View>

      <WebView
        ref={webRef}
        source={{ uri: PAINEL_ORIGIN }}
        injectedJavaScriptBeforeContentLoaded={injecao}
        // Nada sobrevive ao fim da sessão: celular emprestado não reabre o
        // painel de quem usou antes.
        incognito
        // Segunda barreira, no nível da própria WebView.
        originWhitelist={[PAINEL_ORIGIN]}
        // Só o painel carrega aqui dentro. A comparação é por ORIGEM, nunca por
        // prefixo de string: `startsWith` deixaria passar `trackgo.site.evil.com`
        // e `trackgo.site@evil.com` (host real `evil.com`), e como o script
        // injetado roda em TODO documento de main frame, o JWT do funcionário
        // seria escrito no localStorage da origem do atacante.
        onShouldStartLoadWithRequest={(req) => {
          if (ehLoginDoPainel(req.url)) {
            // Sessão morta: o painel tenta mandar pro login dele. Quem manda no
            // login é o app — duas fontes de sessão é onde a bagunça vira vazamento.
            sair();
            return false;
          }
          if (ehDoPainel(req.url)) return true;
          if (/^(blob|data):/.test(req.url)) return true; // download do próprio painel
          Linking.openURL(req.url).catch(() => {});
          return false;
        }}
        // pushState do Next não dispara o callback acima no iOS, e é por ele que
        // o painel vai pro próprio /login quando o token some do localStorage.
        onNavigationStateChange={(nav) => {
          if (ehLoginDoPainel(nav.url)) sair();
        }}
        style={styles.web}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.navy },
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.navy,
  },
  nome: { color: colors.white, fontSize: 15, fontWeight: '600', flex: 1 },
  sair: { color: colors.orange, fontSize: 15, fontWeight: '700' },
  web: { flex: 1, backgroundColor: colors.white },
});
```

- [ ] **Step 4: Verificar tipos**

```bash
cd mobile && npx tsc --noEmit
```

Esperado: nenhum erro.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/interno mobile/package.json mobile/package-lock.json
git commit -m "feat(mobile): painel do time interno embarcado com sessão injetada e navegação travada"
```

---

## Task 12: Gate de rotas conhecendo os dois mundos

**Files:**
- Modify: `mobile/src/app/_layout.tsx`
- Modify: `mobile/src/app/index.tsx`

**Interfaces:**
- Consumes: `resolveBootWorld` (Task 7), `useInternalAuth` (Task 8).
- Produces: boot que abre o mundo certo e nunca deixa os dois vivos.

- [ ] **Step 1: Ensinar o gate a enxergar o mundo interno**

Em `mobile/src/app/_layout.tsx`, acrescentar os imports:

```ts
import { useInternalAuth } from '@/lib/internal-auth-store';
import { resolveBootWorld } from '@/lib/session-keys';
```

Trocar a linha que lê o store por:

```ts
  const { token, hydrated, hydrate, mustChangePassword, logout } = useAuth();
  const interno = useInternalAuth();
```

Trocar o efeito de hidratação por:

```ts
  useEffect(() => {
    diag('03-effect-hydrate');
    hydrate();
    interno.hydrate();
  }, [hydrate]);
```

Substituir o efeito do gate de auth inteiro por:

```ts
  useEffect(() => {
    if (!hydrated || !interno.hydrated) return;

    const mundo = resolveBootWorld(token, interno.token);
    const noInterno = segments[0] === 'interno';
    const inApp = segments[0] === '(tabs)' || segments[0] === 'vehicle';
    const naTrocaDeSenha = segments[0] === 'change-password';
    const naRecuperacao = segments[0] === 'forgot-password';

    // Estado impossível (os dois tokens vivos): apaga tudo e volta pro login.
    if (token && interno.token) {
      logout();
      interno.logout();
      router.replace('/login');
      return;
    }

    if (mundo === 'internal') {
      if (!noInterno) router.replace('/interno/painel');
      return;
    }

    if (mundo === 'none') {
      if (inApp || naTrocaDeSenha || noInterno) router.replace('/login');
      return;
    }

    // Daqui pra baixo é o mundo do associado — regras idênticas às de hoje.
    if (noInterno) {
      router.replace('/(tabs)');
      return;
    }
    if (naRecuperacao) {
      router.replace('/(tabs)');
      return;
    }
    if (mustChangePassword) {
      if (!naTrocaDeSenha) router.replace('/change-password');
      return;
    }
    if (!inApp && !naTrocaDeSenha) router.replace('/(tabs)');
  }, [
    token,
    interno.token,
    hydrated,
    interno.hydrated,
    mustChangePassword,
    segments,
    router,
  ]);
```

Acrescentar a tela no `<Stack>`, logo depois de `<Stack.Screen name="(tabs)" />`:

```tsx
        <Stack.Screen name="interno" />
```

- [ ] **Step 2: Ajustar a rota inicial**

Substituir o corpo de `mobile/src/app/index.tsx` por:

```tsx
import { Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from '@/lib/auth-store';
import { useInternalAuth } from '@/lib/internal-auth-store';
import { resolveBootWorld } from '@/lib/session-keys';
import { colors } from '@/lib/theme';
import { diag } from '@/lib/diag';

/**
 * Rota inicial "/". Mostra carregamento visível (nunca tela branca) enquanto as
 * duas sessões são lidas, e então abre o mundo certo.
 */
export default function Index() {
  diag('04-index-render');
  const { token, hydrated } = useAuth();
  const interno = useInternalAuth();

  if (!hydrated || !interno.hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.orange} />
      </View>
    );
  }

  const mundo = resolveBootWorld(token, interno.token);
  if (mundo === 'internal') return <Redirect href="/interno/painel" />;
  if (mundo === 'associate') return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
  },
});
```

- [ ] **Step 3: Verificar tipos e rodar a suíte**

```bash
cd mobile && npx tsc --noEmit && npm test
```

Esperado: nenhum erro de tipo; 17 testes passando.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/app/_layout.tsx mobile/src/app/index.tsx
git commit -m "feat(mobile): boot abre o mundo certo e derruba estado de sessão dupla"
```

---

## Task 13: Build, validação em aparelho e publicação

**Files:**
- Modify: `mobile/app.json`

**Interfaces:**
- Consumes: Tasks 6-12 completas; backend das Tasks 1-5 no ar.
- Produces: build EAS instalável e validado nos dois sistemas.

- [ ] **Step 1: Bump de versão**

Em `mobile/app.json`: `expo.version` para `"1.3.0"`, `expo.ios.buildNumber` para `"30"`, `expo.android.versionCode` para `2`. Confirmar que `expo.newArchEnabled` continua `false` — ligar New Arch traz de volta a tela branca no iOS 26.

- [ ] **Step 2: Build de desenvolvimento pra testar em aparelho**

`react-native-webview` e `expo-local-authentication` são módulos nativos: **não dá pra testar por OTA nem no Expo Go**.

```bash
cd mobile && eas build --profile development --platform ios
cd mobile && eas build --profile development --platform android
```

- [ ] **Step 3: Roteiro de validação em aparelho (executar item a item)**

- [ ] Login com CPF de teste → abre o mundo do associado, mapa e veículos como antes
- [ ] Sair, login com e-mail de teste → pede biometria → abre o painel já logado, sem tela de login web
- [ ] O painel mostra **apenas** as telas do `allowedRoutes` daquele usuário
- [ ] Mandar o app pro background por 6 minutos e voltar → pede biometria de novo
- [ ] Errar a biometria 3 vezes → volta pro login e o token some
- [ ] Tocar num link externo dentro do painel → abre no navegador do sistema, não dentro da WebView
- [ ] Sair pelo botão da barra → reabrir o app → painel **não** volta logado
- [ ] **Android especificamente:** navegar entre 3 telas do painel e confirmar que a sessão se mantém. Se cair pro login, o `incognito` está bloqueando `localStorage` no Android — nesse caso remover a prop `incognito` da WebView e, no `sair()`, chamar `webRef.current?.clearCache(true)` antes do `logout()`. Anotar qual caminho foi usado.
- [ ] Desativar o usuário de teste em `/usuarios` no painel web → tocar em qualquer tela dentro do app → cai pro login

- [ ] **Step 4: Rodar a suíte de vazamento contra produção mais uma vez**

```bash
cd backend && LEAK_CPF=<cpf> LEAK_CPF_PASS=<senha> \
  LEAK_EMAIL=<email> LEAK_EMAIL_PASS=<senha> \
  npx ts-node scripts/leak-check.ts
```

Esperado: `Nenhum vazamento. Fronteira intacta.`

- [ ] **Step 5: Confirmar produção de pé**

```bash
curl -s -o /dev/null -w "dashboard: %{http_code}\n" https://trackgo.site/login
curl -s -o /dev/null -w "api: %{http_code}\n" https://api.trackgo.site/api/v1/health
```

Esperado: `200` nos dois.

- [ ] **Step 6: Build de produção e submissão**

```bash
cd mobile && eas build --profile production --platform all
cd mobile && eas submit --platform ios
cd mobile && eas submit --platform android
```

**Antes de submeter à Apple:** criar o usuário interno de demonstração num tenant com dados fictícios e informar as credenciais no App Review Information. Nunca credencial de produção.

- [ ] **Step 7: Commit**

```bash
git add mobile/app.json
git commit -m "chore(mobile): versão 1.3.0 com os dois mundos no mesmo binário"
```

---

## Ordem de execução e dependências

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 (deploy A)
                                        ↓
                              (24h) JWT_REQUIRE_TYPE=true
Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11 → Task 12 → Task 13
```

As Tasks 6-12 podem começar em paralelo às 1-5 (são repositórios de código diferentes), mas a **Task 13 exige a Task 5 concluída** — o app novo só funciona contra o backend com segredos separados.
