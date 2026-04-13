---
name: rastreamento-21-go
description: Referência técnica para desenvolvimento no projeto Rastreamento 21 GO — plataforma de rastreamento veicular com Traccar, NestJS e Next.js. Use quando precisar entender arquitetura, módulos, endpoints, WebSocket ou como adicionar features.
user-invocable: true
---

# Rastreamento 21 GO — Referência Técnica (dev)

Este documento é a fonte única de referência **técnica de desenvolvimento**. Tudo que é produção/operação mora em [docs/DEPLOY.md](../../docs/DEPLOY.md); decisões arquiteturais em [docs/DECISIONS.md](../../docs/DECISIONS.md); convenções e padrões em [docs/CONVENTIONS.md](../../docs/CONVENTIONS.md).

---

## 1. Visão Geral

**Rastreamento 21 GO** é uma plataforma de rastreamento veicular em tempo real com gestão de frotas, alertas, geofencing, relatórios, dispositivos/chips M2M, comandos SMS e integração com a Hinova SGA.

### Arquitetura

```
                     ┌────────────────────────────┐
                     │  Traefik (EasyPanel) / TLS │
                     └──────┬────────┬────────────┘
                            │        │
     ┌──────────────────┐   │        │   ┌────────────────┐
     │  Next.js 16     │◀──┘        └──▶│  NestJS 11     │
     │  frontend       │                 │  backend       │
     │  :3000          │◀─────WS─────────│  :3001         │
     └──────────────────┘                 └───┬────────┬──┘
                                              │        │
                                              ▼        ▼
                                     ┌────────────┐  ┌─────────────┐
                                     │ PostgreSQL │  │ Traccar 6.5 │
                                     │    :5432   │  │   :8082     │
                                     └────────────┘  └──────┬──────┘
                                     ┌────────────┐         │
                                     │  Redis 7   │         │ TCP raw
                                     │   :6379    │         ▼
                                     └────────────┘   rastreadores
                                                      (5001–5055)
```

### Stack

| Camada | Tecnologia | Versão |
|---|---|---|
| Frontend | Next.js (App Router), React, Tailwind, shadcn/ui, MapLibre GL JS, Socket.io-client | 16.2 / 19 / 4 |
| Backend | NestJS, Prisma, Passport JWT, Socket.io, Pino, Swagger, class-validator | 11 / 7.6 |
| Motor GPS | Traccar (REST + WebSocket) | 6.5 |
| Banco | PostgreSQL | 17 |
| Cache | Redis | 7 |
| Integração | Hinova SGA (mock em dev) | v2 |
| Infra dev | Docker Compose local | — |
| Infra prod | Docker Swarm + Traefik via EasyPanel | — |

### Conceitos-chave

- **Multi-tenant:** toda query filtra por `tenantId`. SUPER_ADMIN pode trocar tenant via header `x-tenant-id`.
- **Traccar como motor GPS:** Traccar gerencia devices/positions. O backend sincroniza devices com veículos do banco e consome o WebSocket do Traccar, repassando ao frontend via Socket.io no namespace `/tracking`.
- **Hinova SGA:** sistema externo de gestão de associados/veículos. Sync automático a cada 6h (mock em dev).

---

## 2. Como Rodar Localmente

**Pré-requisitos:** Docker Desktop, Node 22+, npm 10+.

```bash
# 1. Infraestrutura local (PostgreSQL, Redis, Traccar)
docker compose -f docker/docker-compose.yml up -d

# 2. Backend
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npx prisma db seed          # cria tenant + admin
npm run start:dev           # :3001

# 3. Frontend (outro terminal)
cd frontend/dashboard
npm install
npm run dev                 # :3000
```

### URLs locais

| Serviço | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend | http://localhost:3001 |
| Swagger | http://localhost:3001/api/docs |
| Traccar | http://localhost:8082 |

### Credenciais dev (seed)

| Sistema | Email | Senha |
|---|---|---|
| Backend (SUPER_ADMIN) | `admin@rastreamento21go.com.br` | `admin123` |
| Traccar | `admin@rastreamento21go.com.br` | `admin123` |

---

## 3. Estrutura de Pastas

```
rastreamento-21-go/
├── docker/                          # Infra dev local
│   ├── docker-compose.yml           # postgres, redis, traccar
│   ├── postgres/init.sql
│   └── traccar/traccar.xml
│
├── backend/                         # NestJS API
│   ├── src/
│   │   ├── main.ts                  # Helmet, CORS, Swagger, Pino, /api/v1
│   │   ├── app.module.ts            # Guards globais, Throttler, Schedule
│   │   ├── config/configuration.ts
│   │   ├── common/
│   │   │   ├── decorators/          # @Public, @Roles, @CurrentUser
│   │   │   ├── guards/              # JwtAuthGuard, RolesGuard, TenantGuard
│   │   │   ├── filters/             # HttpExceptionFilter
│   │   │   ├── interceptors/        # TransformInterceptor ({ data })
│   │   │   └── dto/                 # PaginationQueryDto
│   │   └── modules/
│   │       ├── auth/                # Login, register, JWT
│   │       ├── prisma/              # PrismaService (PrismaPg adapter)
│   │       ├── tenants/             # CRUD tenants
│   │       ├── vehicles/            # CRUD veículos + block/unblock
│   │       ├── traccar/             # REST + WebSocket Gateway
│   │       ├── alerts/              # Regras de alerta em tempo real
│   │       ├── geofences/           # Ray-casting + sync Traccar
│   │       ├── reports/             # Trips, stops, positions + XLSX/CSV
│   │       ├── hinova/              # Mock + sync service
│   │       ├── devices/             # Rastreadores físicos (IMEI, modelo)
│   │       ├── chips/               # Chips M2M (APN, operadora)
│   │       ├── sms-commands/        # Templates SMS + histórico
│   │       └── server-info/         # GET /api/v1/server/info
│   └── prisma/
│       ├── schema.prisma
│       ├── seed.ts
│       └── migrations/
│
├── frontend/dashboard/              # Next.js 16 dashboard
│   └── src/
│       ├── app/
│       │   ├── (auth)/login/
│       │   └── (dashboard)/
│       │       ├── page.tsx          # Mapa + lista de veículos
│       │       ├── alertas/
│       │       ├── relatorios/
│       │       ├── geofencing/
│       │       ├── dispositivos/
│       │       │   └── [id]/         # Detalhe + SMS commands
│       │       └── configuracoes/
│       ├── components/
│       │   ├── layout/              # Header, Sidebar, StatusBar
│       │   ├── map/                 # MapContainer (MapLibre GL)
│       │   ├── vehicles/            # Sidebar, ListItem, DetailPanel, Filters
│       │   ├── alerts/              # AlertsDropdown
│       │   ├── reports/             # Filters, tables, RouteMap
│       │   ├── geofencing/          # Form, List, Map
│       │   └── ui/                  # shadcn/ui
│       ├── contexts/                # AuthContext, TrackingContext
│       ├── hooks/                   # use-traccar-socket
│       ├── lib/api.ts               # axios + interceptors
│       └── types/                   # auth, vehicle, traccar, alert, device, ...
│
├── docs/                            # Documentação do projeto
│   ├── DEPLOY.md                    # Produção, runbook, credenciais
│   ├── DECISIONS.md                 # ADRs
│   ├── CONVENTIONS.md               # Padrões e regras
│   ├── mobile-app-research.md
│   ├── mobile-app-architecture.md
│   └── mobile-app-roadmap.md
├── skills/rastreamento-21-go/SKILL.md  # (este arquivo)
├── CLAUDE.md                         # Entrada rápida para Claude Code
└── .env.example
```

---

## 4. Módulos do Backend

Todos os endpoints estão sob `/api/v1`. A ordem de guards é: `JwtAuthGuard` → `TenantGuard` → `RolesGuard` → `ThrottlerGuard` (100 req/min).

### 4.1 Auth (`/auth`)

| Endpoint | Método | Acesso | Descrição |
|---|---|---|---|
| `/auth/login` | POST | `@Public` | `{ accessToken, user }` |
| `/auth/register` | POST | SUPER_ADMIN | Cria user + tenta criar no Traccar |
| `/auth/me` | GET | Auth | Retorna user + tenant |

**JWT payload:** `{ sub, email, role, tenantId }`. Senhas com `bcrypt` (10 rounds). Segredo rotacionado — ver ADR-008.

### 4.2 Tenants (`/tenants`) — SUPER_ADMIN

CRUD padrão: `GET /tenants`, `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id` (soft).

### 4.3 Vehicles (`/vehicles`)

| Endpoint | Método | Acesso | Descrição |
|---|---|---|---|
| `/vehicles` | GET | Auth | Listar (filtros: status, plate, search) |
| `/vehicles/:id` | GET | Auth | Detalhe com associado |
| `/vehicles` | POST | ADMIN+ | Cria + device Traccar |
| `/vehicles/:id` | PATCH | ADMIN+ | Atualiza |
| `/vehicles/:id` | DELETE | ADMIN+ | Soft delete |
| `/vehicles/:id/block` | POST | OPERATOR+ | `engineStop` no Traccar |
| `/vehicles/:id/unblock` | POST | OPERATOR+ | `engineResume` |

Placa validada com regex Mercosul: `/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/`.

### 4.4 Traccar (`/traccar` + WS `/tracking`)

**REST:** `/traccar/devices`, `/traccar/positions`, `/traccar/positions/:deviceId/history?from=&to=`.

**TraccarService:** session auto-login, retry com backoff, re-auth no 401. Expõe métodos para devices, positions, commands, users, geofences.

**TraccarGateway:** conecta ao WebSocket `/api/socket` do Traccar, mantém cache `device→tenant/vehicle`, roteia eventos para rooms `tenant:{tenantId}`.

### 4.5 Alerts (`/alerts`)

| Endpoint | Método | Descrição |
|---|---|---|
| `/alerts` | GET | Listar (filtros: type, vehicleId, read, from, to) |
| `/alerts/unread-count` | GET | Contagem não-lidos |
| `/alerts/:id/read` | PATCH | Marcar como lido |
| `/alerts/read-all` | POST | Marcar todos como lidos |

**Tipos:** `SPEED` (> 120 km/h), `IGNITION_ON`, `IGNITION_OFF`, `GEOFENCE_IN`, `GEOFENCE_OUT`, `SOS`, `BATTERY_LOW`, `OFFLINE`.

`AlertsService.processPosition()` é chamado pelo `TraccarGateway` a cada posição e mantém caches de estado (ignição, geofences) para detectar transições.

### 4.6 Geofences (`/geofences`)

CRUD + `/geofences/:id/vehicles` (POST substitui lista vinculada).

- CIRCLE: `{ latitude, longitude, radius }` (metros, Haversine)
- POLYGON: `[[lng, lat], ...]` (GeoJSON, ray-casting)

Sync bidirecional com Traccar.

### 4.7 Reports (`/reports`)

| Endpoint | Query | Descrição |
|---|---|---|
| `/reports/positions` | `deviceId, from, to` | Posições no período |
| `/reports/trips` | `deviceId, from, to` | Viagens |
| `/reports/stops` | `deviceId, from, to` | Paradas (> 5 min) |
| `/reports/export` | `+ format=xlsx\|csv, type=...` | Export |

Detecção: `speed > 2 kn` = movimento; `speed ≤ 2 kn` por ≥ 5 min = parada.

### 4.8 Hinova (`/hinova`)

| Endpoint | Método | Acesso |
|---|---|---|
| `/hinova/sync` | POST | ADMIN+ |
| `/hinova/sync/status` | GET | ADMIN+ |
| `/hinova/vehicles` | GET | ADMIN+ |
| `/hinova/vehicles/search` | GET | ADMIN+ |

Mock controlado por `HINOVA_MOCK=true`. Mock gera 50 veículos fake, 200–800ms latência, 5% falha.

Mapeamento de status: `ATIVO → ACTIVE`, `INATIVO → INACTIVE`, `INADIMPLENTE → DEFAULTING`.

Cron: a cada 6h, upsert associados por CPF, upsert veículos por placa.

### 4.9 Devices (`/devices`)

CRUD de rastreadores físicos (IMEI, modelo, status, chip vinculado, veículo vinculado). Modelos suportados: GT06/GT06N/Concox, J16/J16 Pro, CRX3/CRX3 Nano/CRX Pro 4G, ST310U/ST340/ST350 (Suntech), TK103/TK303/Coban (GPS103), FMB920/FMB120 (Teltonika), Sinotrack ST901/ST905 (H02).

Status: `PENDING_INSTALL`, `INSTALLED`, `CONFIGURING`, `ONLINE`, `OFFLINE`, `MAINTENANCE`, `DEACTIVATED`.

### 4.10 Chips (`/chips`)

CRUD de chips M2M (número, operadora, APN, APN user/pass, ICCID). Vinculado 1:1 com device.

### 4.11 SMS Commands (`/devices/:id/commands`, `/sms-commands`)

Geração de comandos SMS por modelo de rastreador.

**Endpoints:**

| Endpoint | Método | Descrição |
|---|---|---|
| `/devices/:id/commands` | GET | Gera sequência de setup baseada no modelo + chip |
| `/devices/:id/commands` | POST | Dispara um comando específico |
| `/devices/:id/commands/history` | GET | Histórico paginado |
| `/sms-commands/templates` | GET | Todos os templates disponíveis |

**Famílias de templates:** `gt06` (GT06/J16/Concox/CRX), `crx` (CRX3 legacy), `suntech`, `gps103`, `teltonika`, `h02`.

**Endereço nos templates:** prefere DNS (`SERVER_HOSTNAME`, `SERVER_HOSTNAME_BACKUP`), cai para IP raw (`SERVER_PRIMARY_IP`, `SERVER_SECONDARY_IP`) se DNS vazio — ver ADR-005.

**Sequência típica GT06/J16:**
```
1. GMT,W,0,0#                             → fuso horário
2. APN,{apn},{user},{pass}#               → APN do chip
3. SERVER,1,gps1.trackgo.site,5023,0#     → primário
4. SERVER,2,gps2.trackgo.site,5023,0#     → secundário (failover)
5. TIMER,30,3600#                         → intervalos
6. RESET#                                 → reiniciar
```

`FACTORY_RESET` só para `ADMIN`/`SUPER_ADMIN`.

### 4.12 Server Info (`/server/info`)

```
GET /api/v1/server/info → {
  hostname, backupHostname,
  ip, primaryIp, secondaryIp,
  traccar: { version, status },
  ports: [{ port, protocol, models, status }]
}
```

Consumido pela página `/configuracoes` do dashboard.

---

## 5. Frontend

### 5.1 Páginas

| Rota | Arquivo |
|---|---|
| `/` | `app/(dashboard)/page.tsx` — mapa + VehicleSidebar |
| `/alertas` | `app/(dashboard)/alertas/page.tsx` |
| `/relatorios` | `app/(dashboard)/relatorios/page.tsx` |
| `/geofencing` | `app/(dashboard)/geofencing/page.tsx` |
| `/dispositivos` | `app/(dashboard)/dispositivos/page.tsx` |
| `/dispositivos/[id]` | idem — detalhe + SMS commands |
| `/configuracoes` | `app/(dashboard)/configuracoes/page.tsx` |

### 5.2 Componentes principais

| Componente | Responsabilidade |
|---|---|
| `Header` | Logo, AlertsDropdown, menu do usuário |
| `Sidebar` | Navegação principal, filtros de busca |
| `StatusBar` | Contadores (total, movimento, parados, offline, alerta) |
| `MapContainer` | Mapa MapLibre GL, markers, centraliza no veículo selecionado |
| `VehicleSidebar` | Lista lateral com busca e filtro |
| `VehicleListItem` | Card com placa, status, velocidade, endereço |
| `VehicleDetailPanel` | Painel expandido, botões block/unblock |
| `VehicleFilterTabs` | Tabs: Todos, Movimento, Parado, Offline, Alerta |
| `AlertsDropdown` | Dropdown no header |
| `ReportFilters`, `TripsTable`, `StopsTable`, `RouteMap` | Página de relatórios |
| `GeofenceList`, `GeofenceForm`, `GeofenceMap` | Editor de geocercas |

### 5.3 Contexts

| Context | Estado |
|---|---|
| `AuthContext` | `user`, `token`, `isAuthenticated`, `isLoading`, `login()`, `logout()` |
| `TrackingContext` | `vehicles[]`, `selectedVehicleId`, `alerts[]`, `unreadCount`, `statusCounts`, `isSocketConnected`, `selectVehicle()`, `setSearchQuery()`, `setStatusFilter()`, `markAlertRead()`, `markAllAlertsRead()` |

### 5.4 WebSocket hook

```typescript
useTraccarSocket({
  token: string,
  onPositionUpdate?: (p: TraccarPosition) => void,
  onDeviceUpdate?: (d: TraccarDevice) => void,
  onAlert?: (a: Alert) => void,
}) → { isConnected, disconnect }
```

Namespace `/tracking`. Auth: `{ auth: { token } }`. Auto-reconnect com backoff exponencial.

---

## 6. Padrões de Código (resumo)

Regras completas em [docs/CONVENTIONS.md](../../docs/CONVENTIONS.md). Resumo:

- Código em **inglês**, UI em **português BR**.
- TypeScript `strict: true`, sem `any`.
- Arquivos `kebab-case`, classes `PascalCase`, vars `camelCase`.
- Toda query backend filtra por `tenantId`.
- Toda entrada usa DTO com `class-validator`.
- Respostas: `{ data }` ou `{ data, meta }`.
- Rotas frontend em PT-BR, rotas backend em inglês sob `/api/v1`.
- Imports Prisma: `.prisma/client` (não `@prisma/client`).

---

## 7. Como Adicionar Features

### Novo módulo backend

```bash
mkdir -p backend/src/modules/nome-modulo/dto
touch backend/src/modules/nome-modulo/{nome-modulo.module,nome-modulo.service,nome-modulo.controller}.ts
touch backend/src/modules/nome-modulo/dto/{create-nome-modulo,update-nome-modulo,filter-nome-modulo}.dto.ts
```

```typescript
// module
@Module({
  imports: [PrismaModule],
  controllers: [NomeModuloController],
  providers: [NomeModuloService],
  exports: [NomeModuloService],
})
export class NomeModuloModule {}

// service — SEMPRE filtrar por tenantId
async findAll(tenantId: string, query: FilterDto) {
  const { page = 1, perPage = 20 } = query;
  const [data, total] = await Promise.all([
    this.prisma.model.findMany({
      where: { tenantId },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    this.prisma.model.count({ where: { tenantId } }),
  ]);
  return { data, meta: { total, page, perPage } };
}

// controller
@Controller('nome-modulo')
export class NomeModuloController {
  constructor(private service: NomeModuloService) {}

  @Get()
  findAll(@Req() req, @Query() query: FilterDto) {
    return this.service.findAll(req.tenantId, query);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  create(@Req() req, @Body() dto: CreateDto) {
    return this.service.create(req.tenantId, dto);
  }
}
```

Registrar em `app.module.ts`.

### Nova página frontend

```typescript
// frontend/dashboard/src/app/(dashboard)/nome-pagina/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function NomePaginaPage() {
  const [data, setData] = useState([]);
  useEffect(() => {
    api.get('/nome-modulo').then(res => setData(res.data.data));
  }, []);
  return <div className="p-6">{/* ... */}</div>;
}
```

Adicionar link no `components/layout/sidebar.tsx`.

### Novo model Prisma

```prisma
model NovoModel {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  tenantId  String   @map("tenant_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@map("novo_models")
}
```

```bash
cd backend && npx prisma migrate dev --name add-novo-model
npx prisma generate
```

---

## 8. Schema do Banco

Relações principais:

```
Tenant ─┬─ users[]        → User
        ├─ vehicles[]     → Vehicle
        ├─ associates[]   → Associate
        ├─ alerts[]       → Alert
        ├─ geofences[]    → Geofence
        ├─ devices[]      → Device
        ├─ chips[]        → Chip
        └─ smsCommands[]  → SmsCommand

Vehicle ─┬─ tenant, associate?, device?
         ├─ alerts[]
         └─ geofenceVehicles[] → GeofenceVehicle (M:N com Geofence)

Device  ─┬─ tenant, chip?, vehicle?
         └─ smsCommands[]

Chip    ─── tenant, device?
```

Enums principais: `Role`, `VehicleStatus`, `AlertType`, `DeviceStatus`, `SmsCommandStatus`, `GeofenceType`, `AssociateStatus`.

---

## 9. Variáveis de Ambiente

`.env.example` na raiz do repo é a referência. Nunca commitar `.env` real.

### Backend

| Variável | Descrição | Exemplo |
|---|---|---|
| `PORT` | Porta do NestJS | `3001` |
| `DATABASE_URL` | PostgreSQL | `postgresql://postgres:<senha>@localhost:5432/rastreamento21go` |
| `REDIS_URL` | Redis | `redis://localhost:6379` |
| `JWT_SECRET` | Segredo JWT (256+ bits em prod) | *(gerar via `openssl rand -base64 48`)* |
| `JWT_EXPIRATION` | TTL do token | `24h` |
| `TRACCAR_URL` | URL base Traccar | `http://localhost:8082` |
| `TRACCAR_API_URL` | Traccar REST | `http://localhost:8082/api` |
| `TRACCAR_ADMIN_EMAIL` | Admin Traccar | `admin@rastreamento21go.com.br` |
| `TRACCAR_ADMIN_PASSWORD` | Senha Traccar | *(secret)* |
| `HINOVA_BASE_URL` | API Hinova | `https://api.hinova.com.br/api/sga/v2` |
| `HINOVA_MOCK` | Usar mock | `true` / `false` |
| `HINOVA_SYNC_INTERVAL` | ms entre syncs | `21600000` (6h) |
| `SERVER_HOSTNAME` | DNS primário rastreador | `gps1.trackgo.site` |
| `SERVER_HOSTNAME_BACKUP` | DNS secundário | `gps2.trackgo.site` |
| `SERVER_PRIMARY_IP` | Fallback IP primário | `167.71.31.77` |
| `SERVER_SECONDARY_IP` | Fallback IP secundário | `168.144.13.3` |
| `CORS_ORIGINS` | Lista separada por vírgula | `https://trackgo.site,https://www.trackgo.site` |
| `FRONTEND_URL` | URL pública do dashboard | `https://trackgo.site` |
| `NODE_ENV` | — | `development` / `production` |

### Frontend

| Variável | Exemplo |
|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` |
| `NEXT_PUBLIC_WS_URL` | `http://localhost:3001` |
| `NEXT_PUBLIC_TRACCAR_URL` | `http://localhost:8082` |

---

## 10. WebSocket Events

Namespace: `/tracking`. Autenticação: `{ auth: { token: '<jwt>' } }`.

```typescript
// Cliente
const socket = io('http://localhost:3001/tracking', { auth: { token } });

socket.on('position:update', (data: {
  deviceId: number;
  vehicleId: string;
  tenantId: string;
  latitude: number;
  longitude: number;
  speed: number;         // km/h
  course: number;
  address: string;
  attributes: object;
  deviceTime: string;    // ISO
}) => { /* ... */ });

socket.on('device:update', (data: {
  deviceId: number;
  vehicleId: string;
  status: 'online' | 'offline' | 'unknown';
  lastUpdate: string;
}) => { /* ... */ });

socket.on('alert:new', (data: {
  id: string;
  type: AlertType;
  message: string;
  vehicleId: string;
  vehicle: { plate: string; brand: string; model: string };
  createdAt: string;
}) => { /* ... */ });
```

Server filtra por `tenant:{tenantId}` rooms — cada cliente só vê eventos do próprio tenant.

---

## 11. Apps Mobile (resumo)

Planejado, não iniciado. Ver documentos completos:
- [docs/mobile-app-research.md](../../docs/mobile-app-research.md)
- [docs/mobile-app-architecture.md](../../docs/mobile-app-architecture.md)
- [docs/mobile-app-roadmap.md](../../docs/mobile-app-roadmap.md)

**Stack:** React Native + Expo SDK 53, MapLibre RN, socket.io-client, expo-router, Zustand, NativeWind, expo-secure-store, WatermelonDB.

**Dois apps:**

| App | Bundle ID | Público | Roles |
|---|---|---|---|
| `21 GO Admin` | `com.r21go.admin` | Staff 21 GO | SUPER_ADMIN, ADMIN, OPERATOR |
| `21 GO Rastreamento` | `com.r21go.client` | Cliente final | VIEWER |

Migração para Turborepo + packages compartilhados (`shared-types`, `api-client`, `validation`, `utils`) é pré-requisito. Timeline ~16 semanas. Ver ADR-007.

### Endpoints novos necessários (a implementar)

| Endpoint | Descrição |
|---|---|
| `POST /auth/refresh` | Refresh token |
| `POST /notifications/register` | Registrar FCM device token |
| `GET/PATCH /notifications/preferences` | Preferências push |
| `POST /panic` | Modo pânico / SOS |
| `POST /vehicles/:id/share` | Link compartilhado de localização |
