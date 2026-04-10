---
name: rastreamento-21-go
description: Referência completa do projeto Rastreamento 21 GO — plataforma de rastreamento veicular com Traccar, NestJS e Next.js. Use quando precisar entender a arquitetura, convenções, módulos, endpoints ou como adicionar features ao projeto.
user-invocable: true
---

# Rastreamento 21 GO — Skill Reference

Memória permanente do projeto. Use este documento como referência para entender a arquitetura, convenções e como contribuir.

---

## 1. Visão Geral

**Rastreamento 21 GO** é uma plataforma de rastreamento veicular em tempo real com gestão de frotas, alertas, geofencing, relatórios e integração com a Hinova SGA.

### Arquitetura

```
┌─────────────────┐      ┌────────────────┐      ┌────────────────┐
│   Frontend       │─────▶│   Backend       │─────▶│   Traccar 6.5  │
│   Next.js 16     │◀────│   NestJS 11     │◀────│   (Motor GPS)  │
│   :3000          │  WS  │   :3001         │  WS  │   :8082        │
└─────────────────┘      └───────┬────────┘      └────────────────┘
                                  │                         │
                          ┌───────┴────────┐      ┌────────┴───────┐
                          │  PostgreSQL 16 │      │   Hinova SGA   │
                          │  :5432         │      │   (mock/real)  │
                          └───────┬────────┘      └────────────────┘
                          ┌───────┴────────┐
                          │   Redis 7      │
                          │   :6379        │
                          └────────────────┘
```

### Stack Completa

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Frontend | Next.js (App Router), React, TailwindCSS, shadcn/ui, MapLibre GL JS, Socket.io-client | 16.2 / 19 / 4 |
| Backend | NestJS, Prisma ORM, Passport JWT, Socket.io, Pino logger, Swagger | 11 / 7.6 |
| Rastreamento | Traccar (API REST + WebSocket) | 6.5 |
| Banco | PostgreSQL (via Docker) | 16 |
| Cache | Redis (via Docker) | 7 |
| Integração | Hinova SGA (mock em dev) | v2 |
| Infra | Docker Compose local, Nginx reverse proxy | — |

### Conceitos-chave

- **Multi-tenant**: Toda query filtra por `tenantId`. SUPER_ADMIN pode trocar tenant via header `x-tenant-id`.
- **Traccar como motor GPS**: Traccar gerencia devices/positions. O backend sincroniza devices com veículos do banco e consome o WebSocket do Traccar para repassar ao frontend via Socket.io.
- **Hinova SGA**: Sistema externo de gestão de associados/veículos. Sync automático a cada 6h (mock em dev).

---

## 2. Como Rodar

### Pré-requisitos

- Docker Desktop instalado e rodando
- Node.js 22+
- npm 10+

### Subir infraestrutura

```bash
# Na raiz do projeto
docker compose -f docker/docker-compose.yml up -d

# Verificar se tudo subiu (4 containers healthy)
docker compose -f docker/docker-compose.yml ps
```

### Backend

```bash
cd backend

# Instalar dependências
npm install

# Gerar Prisma Client
npx prisma generate

# Rodar migrations
npx prisma migrate dev

# Seed (tenant + admin)
npx prisma db seed

# Iniciar dev server
npm run start:dev
```

### Frontend

```bash
cd frontend/dashboard

# Instalar dependências
npm install

# Iniciar dev server
npm run dev
```

### URLs de Desenvolvimento

| Serviço | URL |
|---------|-----|
| Frontend (Next.js) | http://localhost:3000 |
| Backend (NestJS) | http://localhost:3001 |
| Swagger API Docs | http://localhost:3001/api/docs |
| Traccar UI | http://localhost:8082 |

### Credenciais padrão

| Sistema | Email | Senha |
|---------|-------|-------|
| Backend (SUPER_ADMIN) | admin@rastreamento21go.com.br | admin123 |
| Traccar | admin@rastreamento21go.com.br | admin123 |

---

## 3. Estrutura do Projeto

```
rastreamento-21-go/
├── docker/                          # Infraestrutura Docker
│   ├── docker-compose.yml           # PostgreSQL, Redis, Traccar, Nginx
│   ├── postgres/init.sql            # Cria banco traccar + extensões
│   ├── traccar/traccar.xml          # Config Traccar (DB, API, WebSocket, filtros)
│   └── nginx/nginx.conf             # Reverse proxy (frontend, backend, traccar)
│
├── backend/                         # NestJS API
│   ├── src/
│   │   ├── main.ts                  # Bootstrap: Helmet, CORS, Swagger, Pino, /api/v1
│   │   ├── app.module.ts            # Root module: guards globais, throttler, config
│   │   ├── config/
│   │   │   └── configuration.ts     # Leitura de env vars tipada
│   │   ├── common/
│   │   │   ├── decorators/          # @Public, @Roles, @CurrentUser
│   │   │   ├── guards/              # JwtAuthGuard, RolesGuard, TenantGuard
│   │   │   ├── filters/             # HttpExceptionFilter (erro padronizado)
│   │   │   ├── interceptors/        # TransformInterceptor (resposta padronizada)
│   │   │   └── dto/                 # PaginationQueryDto (page, perPage)
│   │   └── modules/
│   │       ├── auth/                # Login, registro, JWT, Passport
│   │       ├── prisma/              # PrismaService (PrismaPg adapter)
│   │       ├── tenants/             # CRUD de tenants (SUPER_ADMIN)
│   │       ├── vehicles/            # CRUD veículos + block/unblock via Traccar
│   │       ├── traccar/             # Integração Traccar REST + WebSocket Gateway
│   │       ├── alerts/              # Alertas em tempo real (speed, ignição, geofence)
│   │       ├── geofences/           # CRUD geofences + ray-casting + Traccar sync
│   │       ├── reports/             # Trips, stops, positions + export Excel/CSV
│   │       └── hinova/              # Sync com Hinova SGA (mock/real)
│   ├── prisma/
│   │   ├── schema.prisma            # Schema do banco (8 models, 3 enums)
│   │   ├── seed.ts                  # Seed: tenant + admin user
│   │   └── migrations/              # Histórico de migrations
│   └── package.json
│
├── frontend/dashboard/              # Next.js 16 Dashboard
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/login/        # Página de login
│   │   │   └── (dashboard)/         # Layout principal
│   │   │       ├── page.tsx          # Mapa + lista de veículos
│   │   │       ├── alerts/           # Página de alertas
│   │   │       ├── reports/          # Página de relatórios
│   │   │       └── geofencing/       # Página de geofences
│   │   ├── components/
│   │   │   ├── layout/              # Header, Sidebar, StatusBar
│   │   │   ├── map/                 # MapContainer (MapLibre GL)
│   │   │   ├── vehicles/            # VehicleSidebar, ListItem, DetailPanel, Filters
│   │   │   ├── alerts/              # AlertsDropdown
│   │   │   ├── reports/             # ReportFilters, TripsTable, StopsTable, RouteMap
│   │   │   ├── geofencing/          # GeofenceForm, GeofenceList, GeofenceMap
│   │   │   └── ui/                  # shadcn/ui (button, input, card, dialog, etc.)
│   │   ├── contexts/
│   │   │   ├── auth-context.tsx      # Estado de autenticação (login, logout, token)
│   │   │   └── tracking-context.tsx  # Veículos, posições, alertas, WebSocket
│   │   ├── hooks/
│   │   │   └── use-traccar-socket.ts # WebSocket hook (Socket.io, auto-reconnect)
│   │   ├── lib/
│   │   │   └── api.ts               # Axios instance + API objects tipados
│   │   └── types/                   # auth, vehicle, traccar, alert, report, geofence, api
│   └── package.json
│
├── skills/                          # Claude Code Skills
├── .env.example                     # Template de variáveis de ambiente
├── CLAUDE.md                        # Instruções do projeto para Claude
└── package.json                     # Workspace root (npm workspaces)
```

---

## 4. Módulos do Backend

### 4.1 Auth (`/api/v1/auth`)

Autenticação JWT com Passport. Senhas hasheadas com bcrypt (10 rounds).

| Endpoint | Método | Acesso | Descrição |
|----------|--------|--------|-----------|
| `/auth/login` | POST | @Public | Login → `{ accessToken, user }` |
| `/auth/register` | POST | SUPER_ADMIN | Cria usuário + tenta criar no Traccar |
| `/auth/me` | GET | Autenticado | Retorna user + tenant |

**DTOs:** `LoginDto` (email, password min 6), `RegisterDto` (email, password, name, role, tenantId)

**JWT Payload:** `{ sub: userId, email, role, tenantId }`

---

### 4.2 Tenants (`/api/v1/tenants`)

CRUD de tenants (organizações). Apenas SUPER_ADMIN.

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/tenants` | GET | Listar (paginado, com contagem de users/vehicles) |
| `/tenants/:id` | GET | Detalhe |
| `/tenants` | POST | Criar |
| `/tenants/:id` | PATCH | Atualizar |
| `/tenants/:id` | DELETE | Desativar (soft: active=false) |

**DTOs:** `CreateTenantDto` (name, slug, document?, logoUrl?, primaryColor?), `UpdateTenantDto` (partial)

---

### 4.3 Vehicles (`/api/v1/vehicles`)

CRUD de veículos com sincronização Traccar. Block/unblock envia comando engineStop/Resume.

| Endpoint | Método | Acesso | Descrição |
|----------|--------|--------|-----------|
| `/vehicles` | GET | Autenticado | Listar (filtro: status, plate, search) |
| `/vehicles/:id` | GET | Autenticado | Detalhe com associado |
| `/vehicles` | POST | ADMIN+ | Criar + device Traccar |
| `/vehicles/:id` | PATCH | ADMIN+ | Atualizar |
| `/vehicles/:id` | DELETE | ADMIN+ | Soft delete (deletedAt) |
| `/vehicles/:id/block` | POST | OPERATOR+ | Bloquear + engineStop |
| `/vehicles/:id/unblock` | POST | OPERATOR+ | Desbloquear + engineResume |

**DTOs:** `CreateVehicleDto` (plate com regex Mercosul, uniqueId, brand?, model?, year?, etc.), `FilterVehiclesDto` (page, perPage, status?, plate?, search?)

---

### 4.4 Traccar (`/api/v1/traccar` + WebSocket `/tracking`)

Integração com Traccar via REST (Axios + session cookie) e WebSocket.

**REST:**

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/traccar/devices` | GET | Devices do tenant |
| `/traccar/positions` | GET | Posições atuais |
| `/traccar/positions/:deviceId/history` | GET | Histórico (from, to) |

**WebSocket Gateway** (namespace `/tracking`):

| Evento | Direção | Payload |
|--------|---------|---------|
| `position:update` | Server → Client | `TraccarPosition` (com vehicleId, tenantId) |
| `device:update` | Server → Client | `TraccarDevice` (com vehicleId, tenantId) |
| `alert:new` | Server → Client | `Alert` (tipo, mensagem, veículo) |

**TraccarService:**
- Session auto-login com credenciais admin
- Retry com backoff exponencial (3 tentativas, re-auth no 401)
- Operações: devices, positions, commands, users, geofences

**TraccarGateway:**
- Conecta ao WebSocket `/api/socket` do Traccar
- Mantém cache device→tenant/vehicle
- Roteia eventos para rooms `tenant:{tenantId}`

---

### 4.5 Alerts (`/api/v1/alerts`)

Alertas gerados em tempo real baseados nas posições do Traccar.

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/alerts` | GET | Listar (filtro: type, vehicleId, read, from, to) |
| `/alerts/unread-count` | GET | Contagem de não lidos |
| `/alerts/:id/read` | PATCH | Marcar como lido |
| `/alerts/read-all` | POST | Marcar todos como lidos |

**Tipos de alerta:**

| Tipo | Trigger | Descrição |
|------|---------|-----------|
| SPEED | speed > 120 km/h | Excesso de velocidade |
| IGNITION_ON | ignição false→true | Veículo ligado |
| IGNITION_OFF | ignição true→false | Veículo desligado |
| GEOFENCE_IN | entra em geocerca | Entrada em área |
| GEOFENCE_OUT | sai de geocerca | Saída de área |
| SOS | — | Botão de pânico |
| BATTERY_LOW | — | Bateria fraca |
| OFFLINE | — | Dispositivo offline |

**AlertsService.processPosition():** Chamado pelo TraccarGateway a cada atualização de posição. Mantém caches de estado (ignição, geofences) para detectar transições.

---

### 4.6 Geofences (`/api/v1/geofences`)

Geocercas (polígonos/círculos) com sincronização Traccar e vínculo com veículos.

| Endpoint | Método | Acesso | Descrição |
|----------|--------|--------|-----------|
| `/geofences` | GET | Autenticado | Listar com veículos vinculados |
| `/geofences/:id` | GET | Autenticado | Detalhe |
| `/geofences` | POST | ADMIN+ | Criar + sync Traccar |
| `/geofences/:id` | PATCH | ADMIN+ | Atualizar |
| `/geofences/:id` | DELETE | ADMIN+ | Deletar (cascade veículos) |
| `/geofences/:id/vehicles` | POST | ADMIN+ | Vincular veículos (substitui) |

**Coordenadas:**
- CIRCLE: `{ latitude, longitude, radius }` (metros)
- POLYGON: `[[lng, lat], ...]` (formato GeoJSON)

**Algoritmos:** Ray-casting para polígonos, Haversine para círculos.

---

### 4.7 Reports (`/api/v1/reports`)

Relatórios de viagens, paradas e posições com export Excel/CSV.

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/reports/positions` | GET | Posições no período |
| `/reports/trips` | GET | Viagens (distância, duração, velocidade) |
| `/reports/stops` | GET | Paradas (> 5 min) |
| `/reports/export` | GET | Export Excel ou CSV |

**Parâmetros:** `deviceId (int)`, `from (ISO)`, `to (ISO)`, `format? (xlsx|csv)`, `type? (positions|trips|stops)`

**Trip:** start/end times, lat/lng, address, distance (km), duration (min), avg/max speed (km/h)

**Stop:** lat/lng, address, start/end time, duration (min)

**Detecção:** speed > 2 knots = em movimento, speed ≤ 2 knots por ≥ 5 min = parada.

---

### 4.8 Hinova SGA (`/api/v1/hinova`)

Integração com o sistema Hinova SGA para sincronização de associados e veículos.

| Endpoint | Método | Acesso | Descrição |
|----------|--------|--------|-----------|
| `/hinova/sync` | POST | ADMIN+ | Disparar sync manual |
| `/hinova/sync/status` | GET | ADMIN+ | Status do último sync |
| `/hinova/vehicles` | GET | ADMIN+ | Listar veículos da Hinova (paginado) |
| `/hinova/vehicles/search` | GET | ADMIN+ | Buscar por placa |

**Modo mock vs real:** Controlado por `HINOVA_MOCK=true/false` no `.env`.

**HinovaMockService:** Gera 50 veículos fake, simula latência 200-800ms, 5% de falha aleatória.

**HinovaService (real):** Stub — requer credenciais reais da Hinova. Autenticação Bearer token, endpoints `/veiculos`, `/veiculos/busca`.

**HinovaSyncService:**
- Cron: a cada 6 horas
- Paginação: 20 itens por página
- Upsert associados por CPF
- Upsert veículos por placa
- Mapeamento de status: ATIVO→ACTIVE, INATIVO→INACTIVE, INADIMPLENTE→DEFAULTING
- Resultado: `{ created, updated, skipped, errors, duration }`

**Para trocar de mock para real:**
1. Obter credenciais da Hinova
2. Setar `HINOVA_MOCK=false` no `.env`
3. Adicionar `HINOVA_TOKEN` ou implementar autenticação no `HinovaService`
4. Reiniciar o backend

---

### 4.9 Arquitetura de 3 IPs (Multi-Server)

O sistema suporta 3 IPs de servidor para atender requisitos de redundância e manutenção:

| IP | Variável de Ambiente | Finalidade |
|----|---------------------|------------|
| **Primário** | `SERVER_PRIMARY_IP` | Servidor principal do Traccar — onde os rastreadores enviam dados |
| **Secundário** | `SERVER_SECONDARY_IP` | Backup/failover — rastreadores J16/GT06 usam como fallback |
| **Manutenção** | `SERVER_MAINTENANCE_IP` | Acesso técnico remoto para manutenção de dispositivos |

**Módulos envolvidos:**

- **ServerInfoService** (`/api/v1/server/info`): Retorna os 3 IPs no endpoint GET
- **SmsCommandsService**: Gera comandos SMS com SERVER,1 (primário) e SERVER,2 (secundário) para rastreadores que suportam multi-IP
- **Frontend /configuracoes**: Card "Servidores" com os 3 IPs, status e botão copiar
- **Frontend /dispositivos/[id]**: Exibe os 3 IPs quando o modelo suporta (J16, GT06), senão só o primário

**Modelos com suporte a multi-IP (protocolo GT06):**

GT06, GT06N, Concox GT06N, J16, J16 Pro — todos aceitam `SERVER,1` (primário) e `SERVER,2` (secundário) via SMS.

**Sequência de comandos SMS para J16/GT06:**

```
1. GMT,W,0,0#                           → Fuso horário
2. APN,{apn},{user},{pass}#             → APN do chip
3. SERVER,1,{primary_ip},5023,0#        → IP primário
4. SERVER,2,{secondary_ip},5023,0#      → IP secundário (backup)
5. TIMER,30,3600#                       → Intervalo de envio
6. RESET#                               → Reiniciar rastreador
```

**Outros modelos** (Suntech, Teltonika, H02, GPS103, CRX): recebem apenas o IP primário via seus respectivos comandos de configuração.

---

## 5. Componentes do Frontend

### 5.1 Layout

| Componente | Responsabilidade |
|-----------|-----------------|
| `Header` | Logo, AlertsDropdown, menu do usuário (nome, role, logout) |
| `Sidebar` | Navegação principal (Mapa, Alertas, Relatórios, Geofences), filtros de busca |
| `StatusBar` | Contadores de status: total, em movimento, parados, offline, alerta |

### 5.2 Map

| Componente | Props | Responsabilidade |
|-----------|-------|-----------------|
| `MapContainer` | — (usa TrackingContext) | Mapa MapLibre GL com markers de veículos, atualização em tempo real, centraliza no veículo selecionado |

### 5.3 Vehicles

| Componente | Props | Responsabilidade |
|-----------|-------|-----------------|
| `VehicleSidebar` | — (usa TrackingContext) | Lista lateral de veículos com busca e filtro |
| `VehicleListItem` | `vehicle: VehicleWithTracking` | Card de veículo (placa, status, velocidade, endereço) |
| `VehicleDetailPanel` | `vehicle: VehicleWithTracking` | Painel expandido com dados completos, botões block/unblock |
| `VehicleFilterTabs` | `statusCounts` | Tabs de filtro: Todos, Movimento, Parado, Offline, Alerta |
| `BlockConfirmModal` | `vehicle, action, onConfirm` | Modal de confirmação para bloquear/desbloquear veículo |

### 5.4 Alerts

| Componente | Props | Responsabilidade |
|-----------|-------|-----------------|
| `AlertsDropdown` | — (usa TrackingContext) | Dropdown no header com últimos alertas, contagem de não lidos, link para página de alertas |

### 5.5 Reports

| Componente | Props | Responsabilidade |
|-----------|-------|-----------------|
| `ReportFilters` | `onFilter(deviceId, from, to)` | Seletor de veículo + date range picker |
| `TripsTable` | `trips: Trip[]` | Tabela de viagens com distância, duração, velocidade |
| `StopsTable` | `stops: Stop[]` | Tabela de paradas com endereço e duração |
| `RouteMap` | `positions: TraccarPosition[]` | Mapa com rota desenhada (polyline) |

### 5.6 Geofencing

| Componente | Props | Responsabilidade |
|-----------|-------|-----------------|
| `GeofenceList` | `geofences, onSelect, onDelete` | Lista de geocercas com status ativo/inativo |
| `GeofenceForm` | `geofence?, onSubmit` | Formulário para criar/editar geocerca (nome, tipo, cor) |
| `GeofenceMap` | `geofences, editingGeofence?, onCoordinatesChange` | Editor visual no mapa (desenhar polígono/círculo) |

### 5.7 Contexts

| Context | Estado Principal | Métodos |
|---------|-----------------|---------|
| `AuthContext` | user, token, isAuthenticated, isLoading | login(), logout() |
| `TrackingContext` | vehicles[], selectedVehicleId, alerts[], unreadCount, statusCounts, isSocketConnected | selectVehicle(), setSearchQuery(), setStatusFilter(), markAlertRead(), markAllAlertsRead() |

### 5.8 WebSocket Hook

```typescript
useTraccarSocket({
  token: string,
  onPositionUpdate?: (position: TraccarPosition) => void,
  onDeviceUpdate?: (device: TraccarDevice) => void,
  onAlert?: (alert: Alert) => void,
}) → { isConnected: boolean, disconnect: () => void }
```

Conecta ao namespace `/tracking` via Socket.io. Auto-reconnect com backoff exponencial. Autenticação via `{ auth: { token } }`.

---

## 6. Integração Hinova SGA

### Fluxo de Sincronização

```
┌──────────┐    GET /veiculos     ┌──────────────┐
│  Backend  │────────────────────▶│  Hinova SGA  │
│  Sync     │◀────────────────────│  (ou Mock)   │
│  Service  │    JSON response    └──────────────┘
└─────┬─────┘
      │
      ▼ Para cada veículo:
  1. Upsert Associate (match por CPF)
  2. Upsert Vehicle (match por placa)
  3. Mapear status: ATIVO→ACTIVE, INATIVO→INACTIVE, INADIMPLENTE→DEFAULTING
  4. Salvar hinovaCode para referência cruzada
```

### Dados retornados pela Hinova

```typescript
HinovaVehicleDto {
  codigoVeiculo: string    // ID interno Hinova
  placa: string            // Placa do veículo
  chassi: string
  renavam: string
  marca: string
  modelo: string
  cor: string
  anoFabricacao: number
  anoModelo: number
  status: 'ATIVO' | 'INATIVO' | 'INADIMPLENTE'
  associado: {
    codigoAssociado: string
    nome: string
    cpf: string
    rg: string
    dataNascimento: string  // ISO date
    telefone: string
    email: string
  }
}
```

### Mock vs Real

| Aspecto | Mock (`HINOVA_MOCK=true`) | Real (`HINOVA_MOCK=false`) |
|---------|---------------------------|---------------------------|
| Dados | 50 veículos gerados aleatoriamente | API real da Hinova |
| Latência | 200-800ms simulada | Real |
| Falhas | 5% aleatório | Reais |
| Credenciais | Não precisa | `HINOVA_BASE_URL`, token de autenticação |
| Uso | Desenvolvimento e testes | Produção |

### Como trocar para API real

1. Obter credenciais da Hinova SGA
2. No `.env`: `HINOVA_MOCK=false`
3. Configurar autenticação no `HinovaService` (Bearer token ou OAuth)
4. Reiniciar o backend

---

## 7. Padrões e Convenções

### Linguagem

| Contexto | Idioma |
|----------|--------|
| Variáveis, funções, classes, arquivos | Inglês |
| UI, mensagens para o usuário | Português BR |
| Comentários no código | Português ou inglês |

### TypeScript

- `strict: true` em todos os projetos
- Sem `any` — tipos explícitos sempre
- Interfaces para dados externos, types para internos

### DTOs e Validação

```typescript
// Toda entrada no backend usa class-validator
class CreateVehicleDto {
  @IsString()
  @Matches(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/)
  plate: string;

  @IsString()
  uniqueId: string;

  @IsOptional()
  @IsString()
  brand?: string;
}
```

### Respostas Padronizadas

```typescript
// Lista paginada
{
  "data": [...],
  "meta": { "total": 100, "page": 1, "perPage": 20 }
}

// Item único
{
  "data": { ... }
}

// Erro
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "timestamp": "2026-03-30T18:00:00.000Z"
}
```

### Guards (ordem de execução)

1. **JwtAuthGuard** — Valida token JWT (skip se @Public)
2. **TenantGuard** — Extrai tenantId do user (SUPER_ADMIN pode override via `x-tenant-id`)
3. **RolesGuard** — Verifica @Roles() (skip se não decorado)
4. **ThrottlerGuard** — Rate limit: 100 req/min

### Roles (hierarquia)

| Role | Pode fazer |
|------|-----------|
| SUPER_ADMIN | Tudo + gerenciar tenants + trocar tenant |
| ADMIN | CRUD veículos, geofences, sync Hinova, registrar users |
| OPERATOR | Block/unblock veículos, visualizar tudo |
| VIEWER | Apenas visualizar mapa, alertas, relatórios |

### WebSocket — Eventos e Payloads

```typescript
// Cliente conecta ao namespace /tracking
const socket = io('http://localhost:3001/tracking', {
  auth: { token: 'jwt-token-aqui' }
});

// Servidor emite:
socket.on('position:update', (data: {
  deviceId: number,
  vehicleId: string,
  tenantId: string,
  latitude: number,
  longitude: number,
  speed: number,       // km/h
  course: number,
  address: string,
  attributes: object,
  deviceTime: string   // ISO
}) => {});

socket.on('device:update', (data: {
  deviceId: number,
  vehicleId: string,
  status: string,      // 'online' | 'offline' | 'unknown'
  lastUpdate: string
}) => {});

socket.on('alert:new', (data: {
  id: string,
  type: AlertType,
  message: string,
  vehicleId: string,
  vehicle: { plate, brand, model },
  createdAt: string
}) => {});
```

### Prisma — Models e Relações

```
Tenant ─┬─ users[]      → User
        ├─ vehicles[]   → Vehicle
        ├─ associates[] → Associate
        ├─ alerts[]     → Alert
        └─ geofences[]  → Geofence

User ──── tenant → Tenant

Vehicle ─┬─ tenant     → Tenant
         ├─ associate? → Associate
         ├─ alerts[]   → Alert
         └─ geofenceVehicles[] → GeofenceVehicle

Associate ─┬─ tenant    → Tenant
           └─ vehicles[] → Vehicle

Alert ─┬─ vehicle → Vehicle
       └─ tenant  → Tenant

Geofence ─┬─ tenant → Tenant
          └─ geofenceVehicles[] → GeofenceVehicle

GeofenceVehicle ─┬─ geofence → Geofence (cascade delete)
                 └─ vehicle  → Vehicle  (cascade delete)
```

---

## 8. Como Adicionar Features

### Novo módulo no Backend

```bash
# 1. Criar estrutura
mkdir -p backend/src/modules/nome-modulo/dto

# 2. Criar arquivos
touch backend/src/modules/nome-modulo/{nome-modulo.module,nome-modulo.service,nome-modulo.controller}.ts
touch backend/src/modules/nome-modulo/dto/{create-nome-modulo,update-nome-modulo,filter-nome-modulo}.dto.ts
```

```typescript
// 3. nome-modulo.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NomeModuloController } from './nome-modulo.controller';
import { NomeModuloService } from './nome-modulo.service';

@Module({
  imports: [PrismaModule],
  controllers: [NomeModuloController],
  providers: [NomeModuloService],
  exports: [NomeModuloService],
})
export class NomeModuloModule {}

// 4. nome-modulo.service.ts
@Injectable()
export class NomeModuloService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, query: FilterDto) {
    const { page = 1, perPage = 20 } = query;
    const [data, total] = await Promise.all([
      this.prisma.model.findMany({
        where: { tenantId },   // SEMPRE filtrar por tenant
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.model.count({ where: { tenantId } }),
    ]);
    return { data, meta: { total, page, perPage } };
  }
}

// 5. nome-modulo.controller.ts
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

// 6. Registrar no app.module.ts
imports: [..., NomeModuloModule],
```

### Nova página no Frontend

```bash
# 1. Criar página
mkdir -p frontend/dashboard/src/app/\(dashboard\)/nome-pagina
touch frontend/dashboard/src/app/\(dashboard\)/nome-pagina/page.tsx

# 2. Criar componentes
mkdir -p frontend/dashboard/src/components/nome-pagina
```

```typescript
// 3. page.tsx
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function NomePaginaPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/nome-modulo')
      .then(res => setData(res.data.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Título em Português</h1>
      {/* componentes aqui */}
    </div>
  );
}

// 4. Adicionar link no Sidebar
// frontend/dashboard/src/components/layout/sidebar.tsx
```

### Novo model no Prisma

```prisma
// 1. Adicionar ao schema.prisma
model NovoModel {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  tenantId  String   @map("tenant_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@map("novo_models")  // snake_case no banco
}

// 2. Adicionar relação no Tenant
model Tenant {
  ...
  novoModels NovoModel[]
}
```

```bash
# 3. Rodar migration
cd backend && npx prisma migrate dev --name add-novo-model

# 4. Regenerar client
npx prisma generate
```

---

## 9. Checklist de Produção

### Segurança

- [ ] Trocar `JWT_SECRET` para uma chave forte (256+ bits)
- [ ] Trocar senha do Traccar admin
- [ ] Trocar senha do PostgreSQL
- [ ] Desativar `registration.enable` no traccar.xml
- [ ] Configurar HTTPS (Nginx com certificado SSL)
- [ ] Revisar CORS origins (remover localhost)
- [ ] Configurar rate limiting adequado
- [ ] Adicionar validação de força de senha

### Banco de Dados

- [ ] Configurar backup automático do PostgreSQL
- [ ] Criar índices adicionais para queries frequentes
- [ ] Configurar connection pooling (PgBouncer ou similar)
- [ ] Rodar `prisma migrate deploy` (não `dev`) em produção

### Infraestrutura

- [ ] Docker Compose para produção (sem volumes de dev)
- [ ] Health checks em todos os serviços
- [ ] Configurar limites de memória nos containers
- [ ] Monitoramento com Prometheus/Grafana ou similar
- [ ] Log aggregation (ELK, Loki ou similar)
- [ ] CI/CD pipeline (GitHub Actions)

### Aplicação

- [ ] `HINOVA_MOCK=false` + credenciais reais
- [ ] `NODE_ENV=production`
- [ ] Build otimizado do frontend (`next build`)
- [ ] Build do backend (`nest build`)
- [ ] Configurar domínio e DNS
- [ ] Testar WebSocket em produção (WSS)
- [ ] Testar sync Hinova com dados reais

### Traccar

- [ ] Configurar protocolos GPS necessários (além do OsmAnd)
- [ ] Ajustar filtros de posição para produção
- [ ] Configurar notificações nativas do Traccar
- [ ] Revisar limites de memória JVM (`-Xms`, `-Xmx`)

---

## 10. Variáveis de Ambiente

### Backend

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `PORT` | Porta do servidor NestJS | `3001` |
| `DATABASE_URL` | Connection string PostgreSQL | `postgresql://postgres:postgres@localhost:5432/rastreamento21go` |
| `REDIS_URL` | Connection string Redis | `redis://localhost:6379` |
| `JWT_SECRET` | Segredo para assinar tokens JWT | `dev-secret-change-in-production` |
| `JWT_EXPIRATION` | Tempo de expiração do JWT | `24h` |
| `TRACCAR_URL` | URL base do Traccar | `http://localhost:8082` |
| `TRACCAR_API_URL` | URL da API REST do Traccar | `http://localhost:8082/api` |
| `TRACCAR_ADMIN_EMAIL` | Email do admin Traccar | `admin@rastreamento21go.com.br` |
| `TRACCAR_ADMIN_PASSWORD` | Senha do admin Traccar | `admin123` |
| `HINOVA_BASE_URL` | URL base da API Hinova SGA | `https://api.hinova.com.br/api/sga/v2` |
| `HINOVA_MOCK` | Usar mock da Hinova (true/false) | `true` |
| `HINOVA_SYNC_INTERVAL` | Intervalo de sync em ms (padrão 6h) | `21600000` |
| `SERVER_PRIMARY_IP` | IP primário do servidor Traccar | `0.0.0.0` |
| `SERVER_SECONDARY_IP` | IP secundário (backup/failover) | `0.0.0.0` |
| `SERVER_MAINTENANCE_IP` | IP de manutenção (acesso técnico) | `0.0.0.0` |

### Frontend

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `NEXT_PUBLIC_API_URL` | URL do backend | `http://localhost:3001` |
| `NEXT_PUBLIC_WS_URL` | URL do WebSocket | `http://localhost:3001` |
| `NEXT_PUBLIC_TRACCAR_URL` | URL do Traccar (UI) | `http://localhost:8082` |

---

## 11. Apps Mobile (Planejado)

> Documentação completa em `docs/mobile-app-research.md`, `docs/mobile-app-architecture.md` e `docs/mobile-app-roadmap.md`.

### Decisão Técnica

**Framework:** React Native + Expo SDK 53 (RN 0.79, React 19)

**Razões:** Compartilhamento de 60-70% de código com dashboard Next.js (tipos, API client, validação, utils); mesmo TypeScript do backend e frontend; MapLibre React Native alinhado com MapLibre GL JS do dashboard web.

### Dois Apps via Build Flavors

| App | Bundle ID | Público | Roles |
|-----|-----------|---------|-------|
| **21 GO Admin** | `com.r21go.admin` | Empresa 21 GO e técnicos | SUPER_ADMIN, ADMIN, OPERATOR |
| **21 GO Rastreamento** | `com.r21go.client` | Donos de veículos (loja) | VIEWER |

### Stack Mobile

| Camada | Tecnologia |
|--------|-----------|
| Framework | Expo SDK 53 (React Native 0.79) |
| Mapas | @maplibre/maplibre-react-native v11 |
| Real-time | socket.io-client v4.8 |
| Navegação | expo-router v4 |
| Push | @react-native-firebase/messaging + firebase-admin |
| Estilos | NativeWind v4 (Tailwind) |
| Estado | Zustand |
| Auth Storage | expo-secure-store |
| KV Storage | react-native-mmkv |
| Offline DB | WatermelonDB |
| Biometria | expo-local-authentication |
| QR Scanner | expo-camera |
| Bluetooth | react-native-ble-plx |
| Monorepo | Turborepo |

### Estrutura no Monorepo

```
rastreamento-21-go/
├── apps/
│   ├── backend/        # NestJS (existente)
│   ├── dashboard/      # Next.js (existente)
│   └── mobile/         # Expo React Native (novo)
├── packages/
│   ├── shared-types/   # TypeScript interfaces
│   ├── api-client/     # HTTP client tipado
│   ├── validation/     # Zod schemas
│   └── utils/          # Funções utilitárias
└── turbo.json
```

### Features por App

**App Admin:**
- Mapa com TODOS os veículos em tempo real
- Bloqueio remoto
- QR Scanner para IMEI de rastreadores
- Comandos SMS para rastreadores
- Gestão de chips M2M
- BLE diagnóstico de rastreadores
- Relatórios e histórico completo
- CRUD geofences
- Alertas operacionais

**App Cliente:**
- Mapa com APENAS seus veículos
- Histórico de rotas
- Alertas personalizados
- Botão de resgate / modo pânico
- Compartilhar localização com familiares
- Boletos e pagamentos (futuro: Hinova)
- Notificações push

### Endpoints Backend Necessários para Mobile

Endpoints existentes que o mobile consome:

| Módulo | Endpoints | Mobile |
|--------|-----------|--------|
| Auth | `/auth/login`, `/auth/me` | Ambos apps |
| Vehicles | `/vehicles`, `/vehicles/:id`, `/vehicles/:id/block` | Admin (CRUD), Cliente (read) |
| Traccar | `/traccar/positions`, `/traccar/positions/:id/history` | Ambos apps |
| Alerts | `/alerts`, `/alerts/:id/read`, `/alerts/read-all` | Ambos apps |
| Geofences | `/geofences`, `/geofences/:id` | Admin (CRUD), Cliente (read) |
| Reports | `/reports/trips`, `/reports/stops`, `/reports/positions` | Admin |

Endpoints novos necessários:

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/auth/refresh` | POST | Refresh token (mobile precisa) |
| `/notifications/register` | POST | Registrar device token FCM |
| `/notifications/preferences` | GET/PATCH | Preferências de push por tipo |
| `/panic` | POST | Acionar modo pânico / SOS |
| `/vehicles/:id/share` | POST | Gerar link de compartilhamento |

### Timeline

- **Fase 0 (2 sem):** Setup monorepo + Expo
- **Fase 1 (8 sem):** App Cliente MVP
- **Fase 2 (6 sem):** App Admin MVP
- **Total: ~16 semanas**

### Variáveis de Ambiente Mobile

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `EXPO_PUBLIC_API_URL` | URL do backend | `https://api.trackgo.site` |
| `EXPO_PUBLIC_WS_URL` | URL do WebSocket | `wss://api.trackgo.site` |
| `EXPO_PUBLIC_MAP_STYLE_URL` | URL do estilo MapLibre | `https://api.maptiler.com/maps/streets-v2/style.json?key=KEY` |
