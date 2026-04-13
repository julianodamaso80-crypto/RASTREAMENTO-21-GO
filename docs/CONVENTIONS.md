# Convenções — Rastreamento 21 GO

Padrões obrigatórios do projeto. Se uma regra aqui entra em conflito com um hábito pessoal, a regra ganha. Se você achar que uma regra está errada, abra discussão antes de quebrar.

---

## 1. Idioma

| Contexto | Idioma |
|---|---|
| Nomes de variáveis, funções, classes, arquivos, branches | **Inglês** |
| UI, mensagens para o usuário, labels, toasts, emails | **Português BR** |
| Comentários no código | Português ou inglês (escolha a que for mais clara) |
| Commit messages | Português (estilo conventional commits) |
| Documentação (`docs/`, `CLAUDE.md`, `SKILL.md`) | Português |

**Consequência prática:** `DeviceStatus.MAINTENANCE` (enum em inglês) aparece na UI como `"Manutenção"` via mapa de labels em [types/device.ts](../frontend/dashboard/src/types/device.ts).

---

## 2. Nomenclatura

| Elemento | Convenção | Exemplo |
|---|---|---|
| Arquivos TS/TSX | `kebab-case` | `vehicle-list-item.tsx`, `sms-commands.service.ts` |
| Classes, tipos, interfaces, enums | `PascalCase` | `VehicleService`, `TraccarPosition`, `DeviceStatus` |
| Variáveis, funções, métodos, propriedades | `camelCase` | `getServerAddress()`, `primaryIp` |
| Constantes (env, literais globais) | `UPPER_SNAKE_CASE` | `SERVER_PRIMARY_IP`, `TRACCAR_PORTS` |
| Tabelas/colunas do banco | `snake_case` (via `@map`/`@@map` do Prisma) | `tenant_id`, `created_at`, `sms_commands` |
| Services EasyPanel | sufixo `-rastreamento` | `backend-rastreamento` (ver ADR-002) |

---

## 3. Rotas

### Backend — sempre em **inglês** sob o prefixo `/api/v1`

```
/api/v1/auth/login
/api/v1/vehicles
/api/v1/devices/:id/commands
/api/v1/alerts/unread-count
```

### Frontend — sempre em **português BR**

```
/                → mapa principal
/alertas         → lista de alertas
/relatorios      → relatórios (trips, stops, positions)
/geofencing      → geocercas
/dispositivos    → dispositivos (rastreadores)
/configuracoes   → configurações do sistema
```

**Razão.** A API é um contrato técnico (fica estável mesmo se o produto for traduzido) — as rotas do dashboard são parte da experiência do usuário final brasileiro.

---

## 4. TypeScript

- `strict: true` em todos os `tsconfig.json` (backend, frontend, packages futuros).
- Nunca `any`. Se você precisar escapar o type system temporariamente, use `unknown` e faça narrowing explícito.
- `interface` para contratos externos (DTOs, respostas da API, props de componentes). `type` para composições internas (unions, picks, omits).

---

## 5. Multi-tenant — regra de ouro

**Toda query do backend que toca um model com `tenantId` precisa filtrar por `tenantId`.** Sem exceção. Mesmo uma `findFirst` "inocente".

```typescript
// ❌ ERRADO — vaza dados entre tenants
const vehicle = await prisma.vehicle.findUnique({ where: { id } });

// ✅ CORRETO
const vehicle = await prisma.vehicle.findFirst({
  where: { id, tenantId },
});
```

O `tenantId` vem do JWT via `TenantGuard` (`req.tenantId`). SUPER_ADMIN pode trocar o tenant ativo via header `x-tenant-id`.

---

## 6. DTOs e validação (backend)

Toda entrada externa (body, query, params) **obrigatoriamente** passa por um DTO com `class-validator`:

```typescript
import { IsString, IsOptional, Matches, IsInt, Min } from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @Matches(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/, { message: 'Placa inválida' })
  plate: string;

  @IsString()
  uniqueId: string;

  @IsOptional()
  @IsString()
  brand?: string;
}
```

Erros de validação são transformados automaticamente no formato de erro padrão pela `HttpExceptionFilter`.

---

## 7. Formato de resposta

```typescript
// Lista paginada — sempre data + meta
{ "data": [...], "meta": { "total": 100, "page": 1, "perPage": 20 } }

// Item único
{ "data": { ... } }

// Erro
{
  "statusCode": 400,
  "message": "Placa inválida",
  "error": "Bad Request",
  "timestamp": "2026-04-13T13:30:00.000Z"
}
```

O `TransformInterceptor` envolve respostas não-paginadas em `{ data }` automaticamente. Liste paginações com `PaginationQueryDto` (`page`, `perPage`).

---

## 8. Roles (hierarquia)

| Role | Permissões |
|---|---|
| `SUPER_ADMIN` | Tudo + gerenciar tenants + trocar tenant via `x-tenant-id` |
| `ADMIN` | CRUD de veículos, geofences, sync Hinova, registro de usuários |
| `OPERATOR` | Block/unblock de veículos, visualização completa |
| `VIEWER` | Apenas leitura do mapa, alertas, relatórios |

Decore endpoints com `@Roles(Role.ADMIN, Role.SUPER_ADMIN)`. O `RolesGuard` avalia após o `JwtAuthGuard`/`TenantGuard`.

---

## 9. Prisma

### Imports

Use sempre `.prisma/client` (não `@prisma/client`) para evitar um bug recorrente de resolução de tipos em certos setups de Next.js 16 + TS 5:

```typescript
import { PrismaClient, DeviceStatus } from '.prisma/client';
```

### Soft delete

Models com `deletedAt: DateTime?`. Nunca delete fisicamente — sempre setar `deletedAt = new Date()`. Queries padrão filtram `deletedAt: null`.

### Migrations

- Dev: `npx prisma migrate dev --name <nome>`
- Prod: `npx prisma migrate deploy` (nunca `migrate dev` em produção)
- Nunca editar uma migration já aplicada — crie uma nova.

---

## 10. Logs

- Backend usa `nestjs-pino`. Logs são JSON estruturados em produção, pretty em dev.
- Nunca logar senhas, tokens, JWT secrets, CPF completo, telefone completo.
- Use `this.logger.log(...)` / `.warn(...)` / `.error(...)` com contexto.

---

## 11. Frontend — padrões de componentes

- Componentes ficam em `frontend/dashboard/src/components/<feature>/`.
- Shadcn/ui em `components/ui/` — não editar, apenas consumir.
- Contextos globais em `src/contexts/` (`AuthContext`, `TrackingContext`).
- Hooks customizados em `src/hooks/`.
- Tipos em `src/types/<feature>.ts`.
- Chamadas HTTP sempre via `src/lib/api.ts` (axios com interceptors de auth).

---

## 12. Commits

Seguir padrão conventional commits em português:

```
feat: adiciona CRUD de geofences
fix(security): rotaciona JWT_SECRET inseguro em produção
fix(infra): 3→2 servidores e limpa var MAINTENANCE órfã
docs: refatora documentação para single source of truth
refactor(backend): move lógica de SMS para módulo dedicado
```

Commits atômicos, mensagem com contexto ("por quê"), corpo explicando consequências quando aplicável.
