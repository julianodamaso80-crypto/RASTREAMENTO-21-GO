# Rastreamento 21 GO — Skill Reference

Memória permanente do projeto. Use este documento como referência para entender a arquitetura, convenções e como contribuir.

---

## 1. Visão Geral da Arquitetura

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Frontend    │────▶│   Backend    │────▶│   Traccar    │
│  Next.js 16  │◀───│   NestJS     │◀───│   6.5        │
│  :3000       │ WS │   :3001      │ WS │   :8082      │
└─────────────┘     └──────┬───────┘     └──────────────┘
                           │
                    ┌──────┴───────┐
                    │  PostgreSQL  │  Redis
                    │  :5432       │  :6379
                    └──────────────┘
```

**Fluxo de dados em tempo real:**
1. Rastreador GPS envia posição → Traccar (porta 5055 OsmAnd)
2. Traccar processa e disponibiliza via WebSocket
3. Backend (TraccarGateway) conecta no WS do Traccar, recebe posições
4. Backend filtra por tenant, processa alertas (velocidade, ignição, geofence)
5. Backend emite `position:update`, `device:update`, `alert:new` via Socket.io
6. Frontend recebe no TrackingContext e atualiza mapa/sidebar/alertas

**Stack completa:**
| Camada | Tecnologia | Porta |
|--------|-----------|-------|
| Frontend | Next.js 16 + TailwindCSS + shadcn/ui + MapLibre GL JS | 3000 |
| Backend | NestJS + Prisma ORM + Socket.io + Passport JWT | 3001 |
| Rastreamento | Traccar 6.5 (REST + WebSocket) | 8082 |
| Banco | PostgreSQL 16 | 5432 |
| Cache | Redis 7 | 6379 |
| Proxy | Nginx | 80 |

---

## 2. Convenções de Código

| Regra | Detalhe |
|-------|---------|
| Idioma do código | **Inglês** (variáveis, funções, classes, arquivos) |
| Idioma da UI | **Português BR** (mensagens, labels, textos) |
| Comentários | Podem ser em português |
| TypeScript | **Strict** em todos os projetos |
| ORM | Prisma (backend). Import de `.prisma/client` (não `@prisma/client`) |
| Auth | JWT em todas as rotas (exceto `@Public()`) |
| Multi-tenant | Toda query filtra por `tenantId` |
| Respostas | `{ data: T }` ou `{ data: T[], meta: { total, page, perPage } }` |
| Validação | DTOs com `class-validator` (backend) |
| Logs | Pino (nestjs-pino) com structured logging |
| Soft delete | Vehicle usa `deletedAt`, demais usam `active: boolean` |

### Imports do Prisma (IMPORTANTE — Prisma v7)
```typescript
// CORRETO — usar .prisma/client (resolve para backend/node_modules/.prisma/client)
import { PrismaClient, Role, AlertType } from '.prisma/client';

// ERRADO — resolve para root workspace, pode não ter models novos
import { PrismaClient } from '@prisma/client';
```

### Workaround para models Prisma em services
```typescript
// PrismaService herda PrismaClient de @prisma/client (por causa do adapter PrismaPg)
// Novos models podem não aparecer no tipo. Usar cast:
private get alertModel() {
  return (this.prisma as any).alert;
}
```

---

## 3. Como Rodar o Ambiente Local

```bash
# 1. Subir infraestrutura Docker
docker compose -f docker/docker-compose.yml up -d

# 2. Backend
cd backend
cp ../.env.example .env        # Se não existir
npx prisma migrate dev         # Criar tabelas
npx prisma db seed             # Seed: tenant + admin
npm run start:dev              # http://localhost:3001

# 3. Frontend
cd frontend/dashboard
npm run dev                    # http://localhost:3000

# 4. Credenciais
# Login: admin@rastreamento21go.com.br / admin123
# Traccar admin: mesmo email/senha
# PostgreSQL: postgres / postgres
```

### Variáveis de Ambiente (.env do backend)
```
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rastreamento21go
REDIS_URL=redis://localhost:6379
TRACCAR_URL=http://localhost:8082
TRACCAR_API_URL=http://localhost:8082/api
TRACCAR_ADMIN_EMAIL=admin@rastreamento21go.com.br
TRACCAR_ADMIN_PASSWORD=admin123
JWT_SECRET=dev-secret-change-in-production
JWT_EXPIRATION=24h
HINOVA_BASE_URL=https://api.hinova.com.br/api/sga/v2
HINOVA_MOCK=true
HINOVA_SYNC_INTERVAL=21600000
```

---

## 4. Estrutura de Módulos do Backend

```
backend/src/
├── main.ts                    # Bootstrap: Helmet, CORS, Swagger, Pino, ValidationPipe
├── app.module.ts              # Wiring: ConfigModule, LoggerModule, ThrottlerModule, ScheduleModule
├── config/configuration.ts    # Tipagem das env vars
├── common/
│   ├── decorators/            # @Public(), @Roles(), @CurrentUser()
│   ├── guards/                # JwtAuthGuard, RolesGuard, TenantGuard (todos globais)
│   ├── filters/               # HttpExceptionFilter
│   ├── interceptors/          # TransformInterceptor ({ data, meta })
│   └── dto/                   # PaginationQueryDto (page, perPage)
└── modules/
    ├── prisma/                # PrismaService (global, extends PrismaClient)
    ├── auth/                  # Login JWT, Register, /me, JwtStrategy
    ├── traccar/               # TraccarService (HTTP), TraccarGateway (WS), TraccarController
    ├── vehicles/              # CRUD + block/unblock + Traccar device sync
    ├── tenants/               # CRUD (SUPER_ADMIN only)
    ├── hinova/                # IHinovaClient interface, Mock/Real services, SyncService (cron)
    ├── alerts/                # Rules engine (speed, ignição, geofence), WebSocket emission
    ├── reports/               # Positions history, trips, stops, Excel/CSV export
    └── geofences/             # CRUD + Traccar sync + point-in-polygon/circle check
```

### Módulos e seus endpoints

| Módulo | Prefixo | Endpoints |
|--------|---------|-----------|
| Auth | `/auth` | POST login, POST register, GET me |
| Traccar | `/traccar` | GET devices, GET positions, GET positions/:id/history |
| Vehicles | `/vehicles` | GET, GET :id, POST, PATCH :id, DELETE :id, POST :id/block, POST :id/unblock |
| Tenants | `/tenants` | GET, GET :id, POST, PATCH :id, DELETE :id |
| Hinova | `/hinova` | POST sync, GET sync/status, GET vehicles, GET vehicles/search |
| Alerts | `/alerts` | GET, GET unread-count, PATCH :id/read, POST read-all |
| Reports | `/reports` | GET positions, GET trips, GET stops, GET export |
| Geofences | `/geofences` | GET, GET :id, POST, PATCH :id, DELETE :id, POST :id/vehicles |

### Guards globais (ordem de execução)
1. **JwtAuthGuard** — valida JWT, pula se `@Public()`
2. **TenantGuard** — extrai `tenantId` do JWT, SUPER_ADMIN pode usar header `x-tenant-id`
3. **ThrottlerGuard** — rate limit 100 req/min

### Roles
```
SUPER_ADMIN  → acesso total, pode agir em qualquer tenant
ADMIN        → admin de uma tenant
OPERATOR     → pode bloquear veículos, ver tudo
VIEWER       → somente leitura
```

---

## 5. Como Adicionar Novas Features

### Novo módulo backend

```bash
# 1. Criar arquivos
backend/src/modules/nova-feature/
├── nova-feature.module.ts
├── nova-feature.service.ts
├── nova-feature.controller.ts
└── dto/
    └── create-nova-feature.dto.ts
```

```typescript
// 2. Module
@Module({
  controllers: [NovaFeatureController],
  providers: [NovaFeatureService],
  exports: [NovaFeatureService],
})
export class NovaFeatureModule {}

// 3. Controller — seguir o padrão
@ApiTags('Nova Feature')
@ApiBearerAuth()
@Controller('nova-feature')
export class NovaFeatureController {
  constructor(private service: NovaFeatureService) {}

  @Get()
  @ApiOperation({ summary: 'Lista items' })
  async findAll(@Req() req: AuthenticatedRequest) {
    return this.service.findAll(req.tenantId);
  }
}

// 4. AuthenticatedRequest interface (local, não importar do Express)
interface AuthenticatedRequest {
  tenantId: string;
  user: { id: string; tenantId: string; role: string };
}

// 5. Registrar no AppModule
import { NovaFeatureModule } from './modules/nova-feature/nova-feature.module';
// ... imports: [..., NovaFeatureModule]
```

### Novo model Prisma

```bash
# 1. Adicionar model em prisma/schema.prisma
# 2. npx prisma migrate dev --name add_nova_feature
# 3. npx prisma generate
# 4. Importar de '.prisma/client' (não @prisma/client)
# 5. Se PrismaService não reconhecer o model, usar workaround:
#    private get novaFeatureModel() { return (this.prisma as any).novaFeature; }
```

### Nova página frontend

```bash
# 1. Criar diretório
frontend/dashboard/src/app/(dashboard)/nova-feature/page.tsx

# 2. Adicionar ao sidebar.tsx
{ href: '/nova-feature', label: 'Nova Feature', icon: SomeIcon },

# 3. Adicionar API ao lib/api.ts
export const novaFeatureApi = { ... };

# 4. Adicionar tipos ao types/nova-feature.ts
```

---

## 6. Integração Hinova SGA

### Arquitetura (Factory Pattern)

```
HINOVA_MOCK=true  → HinovaMockService  (50 veículos fictícios, latência simulada)
HINOVA_MOCK=false → HinovaService      (API real, auth Bearer, retry backoff)
```

Ambos implementam `IHinovaClient`:
```typescript
interface IHinovaClient {
  authenticate(): Promise<void>;
  listVehicles(page: number, perPage: number): Promise<HinovaListResponse>;
  searchByPlate(plate: string): Promise<HinovaVehicleDto | null>;
  searchByCpf(cpf: string): Promise<HinovaVehicleDto[]>;
}
```

### Sync automático
- `HinovaSyncService` roda via `@Cron(CronExpression.EVERY_6_HOURS)`
- Busca veículos paginados da Hinova
- Para cada: busca no DB por placa+tenant → cria ou atualiza Vehicle + Associate
- Status: ATIVO→ACTIVE, INATIVO→INACTIVE, INADIMPLENTE→DEFAULTING
- Não remove veículos que saíram do SGA (preserva histórico)

### Endpoints
| Método | Path | Descrição |
|--------|------|-----------|
| POST | `/hinova/sync` | Dispara sync manual (ADMIN+) |
| GET | `/hinova/sync/status` | Último sync, próximo, resultado |
| GET | `/hinova/vehicles` | Lista direto da API Hinova |
| GET | `/hinova/vehicles/search?plate=X` | Busca por placa |

### Para ativar API real
1. Obter credenciais da Hinova
2. Setar `HINOVA_MOCK=false` no `.env`
3. Implementar `authenticate()` em `hinova.service.ts` (TODO marcado no código)
4. Ajustar endpoints de busca conforme documentação real da API SGA

---

## 7. Padrões de Componentes do Frontend

### Estrutura de páginas
```typescript
// Página protegida: 'use client' + useTracking()
'use client';
import { useTracking } from '@/contexts/tracking-context';

export default function MinhaPage() {
  const { vehicles, ... } = useTracking();
  return <div className="h-full overflow-y-auto p-6">...</div>;
}
```

### Componentes de mapa
```typescript
// Sempre usar dynamic import (SSR disabled)
const MapComponent = dynamic(
  () => import('@/components/map/my-map').then((m) => m.MyMap),
  { ssr: false, loading: () => <div className="animate-pulse" /> },
);
```

### API calls em componentes
```typescript
// Usar as APIs tipadas de lib/api.ts
import { vehiclesApi } from '@/lib/api';

const data = await vehiclesApi.getAll({ page: 1, perPage: 20 });
// data.data = Vehicle[], data.meta = { total, page, perPage }
```

### Contextos disponíveis
```typescript
// Auth — user, token, login/logout
const { user, isAuthenticated, login, logout } = useAuth();

// Tracking — vehicles, positions, alerts, filters
const {
  vehicles,              // VehicleWithTracking[]
  filteredVehicles,      // após busca + filtro
  selectedVehicleId,     // veículo selecionado
  selectVehicle,         // selecionar veículo
  searchQuery,           // busca atual
  setSearchQuery,        // alterar busca
  statusFilter,          // 'all' | 'moving' | 'stopped' | 'offline' | 'alert'
  setStatusFilter,       // alterar filtro
  statusCounts,          // { total, moving, stopped, offline, alert }
  isSocketConnected,     // status do WebSocket
  alerts,                // Alert[]
  unreadCount,           // número de alertas não lidos
  markAlertRead,         // marcar como lido
  markAllAlertsRead,     // marcar todos
} = useTracking();
```

### Design system
- **Tema:** Dark-first, fundo `#0f172a` (slate-900)
- **Accent:** Emerald-500 (`#10b981`)
- **Glass:** `backdrop-blur-16px bg-slate-800/75 border-slate-700/10`
- **Cards:** `bg-muted/20 rounded-lg border border-border/30`
- **UI components:** shadcn/ui (base-ui, não Radix). **Sem `asChild`** — usar `render` prop ou elemento direto
- **Ícones:** Lucide React
- **Toast:** Sonner (`toast.success()`, `toast.error()`, `toast.warning()`)
- **Fontes:** Inter (via next/font/google)

### WebSocket events (frontend)
```typescript
// Recebidos do backend via Socket.io namespace /tracking
'position:update' → TraccarPosition  // posição atualizada
'device:update'   → TraccarDevice    // status do device
'alert:new'       → Alert            // novo alerta gerado
```

---

## 8. Schema do Banco (Resumo)

```
Tenant ──┬── User
         ├── Vehicle ──┬── Alert
         ├── Associate │   GeofenceVehicle ── Geofence
         ├── Alert     │
         └── Geofence ─┘
```

**Enums:** Role (4), VehicleStatus (4), AlertType (8), GeofenceType (2)

**Models:** Tenant, User, Vehicle, Associate, Alert, Geofence, GeofenceVehicle

---

## 9. Checklist MVP (Completo)

- [x] Docker Compose (Traccar + PostgreSQL + Redis + Nginx)
- [x] Backend NestJS com Swagger
- [x] Auth JWT (login, register, me)
- [x] Dashboard com mapa dark (CartoDB Dark Matter)
- [x] Veículos: CRUD + sidebar + detail panel + block/unblock
- [x] WebSocket tempo real (posições, devices, alertas)
- [x] Sincronização Hinova SGA (mock)
- [x] Multi-tenant (filtro por tenantId)
- [x] Alertas (velocidade, ignição, geofence)
- [x] Relatórios (histórico, viagens, paradas, export Excel/CSV)
- [x] Geofencing (CRUD, mapa, point-in-polygon, alertas entrada/saída)
