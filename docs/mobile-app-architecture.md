# Arquitetura Mobile - Rastreamento 21 GO

> Documento de arquitetura tecnica para os apps mobile Admin e Cliente.

---

## 1. Visao Geral da Arquitetura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          MONOREPO (Turborepo)                          │
├───────────────┬────────────────┬────────────────┬──────────────────────┤
│   apps/       │   apps/        │   apps/        │   packages/          │
│   backend/    │   dashboard/   │   mobile/      │   shared-types/      │
│   (NestJS)    │   (Next.js)    │   (Expo)       │   api-client/        │
│   :3001       │   :3000        │   Expo Go      │   validation/        │
│               │                │                │   utils/             │
└───────┬───────┴───────┬────────┴───────┬────────┴──────────────────────┘
        │               │                │
        │    ┌──────────┴────────────────┘
        │    │  Compartilham: shared-types, api-client, validation, utils
        │    │
        ▼    ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  PostgreSQL 16   │     │   Redis 7        │     │   Traccar 6.5    │
│  (Prisma ORM)    │     │   (Cache)        │     │   (Motor GPS)    │
│  :5432           │     │   :6379          │     │   :8082          │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

---

## 2. Arquitetura do App Mobile (Expo)

```
┌────────────────────────────────────────────────────────┐
│                    EXPO APP (SDK 53)                    │
│                  React Native 0.79                      │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │                 NAVIGATION LAYER                  │  │
│  │              (expo-router v4)                      │  │
│  │                                                    │  │
│  │  (auth)/                                           │  │
│  │    ├── login.tsx                                   │  │
│  │    └── forgot-password.tsx                         │  │
│  │                                                    │  │
│  │  (app)/                                            │  │
│  │    ├── (tabs)/                                     │  │
│  │    │   ├── map.tsx              # Mapa principal   │  │
│  │    │   ├── vehicles.tsx         # Lista veiculos   │  │
│  │    │   ├── alerts.tsx           # Alertas          │  │
│  │    │   └── profile.tsx          # Perfil/Config    │  │
│  │    ├── vehicle/[id].tsx         # Detalhe veiculo  │  │
│  │    ├── vehicle/[id]/history.tsx # Historico rotas  │  │
│  │    ├── scanner.tsx              # QR IMEI (Admin)  │  │
│  │    └── settings.tsx             # Configuracoes    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │                   STATE LAYER                     │  │
│  │                                                    │  │
│  │  ┌─────────────┐  ┌─────────────┐                │  │
│  │  │  AuthStore   │  │TrackingStore│                │  │
│  │  │  (Zustand)   │  │  (Zustand)  │                │  │
│  │  │             │  │             │                │  │
│  │  │ - user      │  │ - vehicles  │                │  │
│  │  │ - tokens    │  │ - positions │                │  │
│  │  │ - tenant    │  │ - alerts    │                │  │
│  │  │ - biometric │  │ - socket    │                │  │
│  │  └─────────────┘  └─────────────┘                │  │
│  │                                                    │  │
│  │  ┌─────────────┐  ┌─────────────┐                │  │
│  │  │VehicleStore │  │ AlertStore  │                │  │
│  │  │  (Zustand)  │  │  (Zustand)  │                │  │
│  │  │             │  │             │                │  │
│  │  │ - list      │  │ - unread    │                │  │
│  │  │ - filters   │  │ - history   │                │  │
│  │  │ - selected  │  │ - push prefs│                │  │
│  │  └─────────────┘  └─────────────┘                │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │                   DATA LAYER                      │  │
│  │                                                    │  │
│  │  ┌──────────────────┐  ┌──────────────────────┐  │  │
│  │  │   API Client      │  │   Socket.io Client   │  │  │
│  │  │   (from package)  │  │   (Real-time)        │  │  │
│  │  │                   │  │                       │  │  │
│  │  │ api.trackgo.site  │  │ wss://api.trackgo    │  │  │
│  │  │ JWT + Refresh     │  │ /tracking namespace  │  │  │
│  │  │ Auto-retry        │  │ Auto-reconnect       │  │  │
│  │  └──────────────────┘  └──────────────────────┘  │  │
│  │                                                    │  │
│  │  ┌──────────────────┐  ┌──────────────────────┐  │  │
│  │  │   WatermelonDB   │  │   MMKV               │  │  │
│  │  │   (Offline DB)   │  │   (Key-Value)        │  │  │
│  │  │                   │  │                       │  │  │
│  │  │ Vehicles, Routes │  │ Tokens, Prefs,       │  │  │
│  │  │ Alerts, Geofences│  │ Last positions       │  │  │
│  │  │ Sync protocol    │  │ Feature flags        │  │  │
│  │  └──────────────────┘  └──────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │               NATIVE MODULES LAYER                │  │
│  │                                                    │  │
│  │  ┌────────────┐ ┌────────────┐ ┌──────────────┐  │  │
│  │  │ MapLibre   │ │ expo-camera│ │ BLE PLX      │  │  │
│  │  │ GL Native  │ │ (QR scan)  │ │ (Bluetooth)  │  │  │
│  │  └────────────┘ └────────────┘ └──────────────┘  │  │
│  │                                                    │  │
│  │  ┌────────────┐ ┌────────────┐ ┌──────────────┐  │  │
│  │  │ expo-notif │ │ expo-loc   │ │ expo-secure  │  │  │
│  │  │ (Push)     │ │ (Location) │ │ (Keychain)   │  │  │
│  │  └────────────┘ └────────────┘ └──────────────┘  │  │
│  │                                                    │  │
│  │  ┌────────────┐ ┌────────────┐                    │  │
│  │  │ expo-local │ │ expo-      │                    │  │
│  │  │ -auth      │ │ contacts   │                    │  │
│  │  │(Biometric) │ │ (Share)    │                    │  │
│  │  └────────────┘ └────────────┘                    │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 3. Fluxo de Dados em Tempo Real

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Rastreador   │────▶│   Traccar    │────▶│   Backend    │
│  GPS (campo)  │TCP  │   6.5        │WS   │   NestJS     │
│  J16/GT06/etc │     │   :8082      │     │   :3001      │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                    Socket.io     │  FCM/APNs
                                    (/tracking)   │  (Push)
                                                  │
                          ┌───────────────────────┼───────────────┐
                          │                       │               │
                          ▼                       ▼               ▼
                  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
                  │  Dashboard   │    │  App Mobile  │    │  App Mobile  │
                  │  Next.js     │    │  (Foreground)│    │  (Background)│
                  │  (Web)       │    │  Socket.io   │    │  Push Notif  │
                  └──────────────┘    └──────────────┘    └──────────────┘
```

### Fluxo Detalhado:

1. **Rastreador GPS** envia posicao via TCP/UDP para o Traccar
2. **Traccar** processa, filtra e disponibiliza via WebSocket `/api/socket`
3. **Backend NestJS** (TraccarGateway) consome o WS do Traccar:
   - Enriquece com `vehicleId` e `tenantId`
   - Emite `position:update` via Socket.io para rooms `tenant:{tenantId}`
   - Processa alertas (velocidade, geofence, ignicao) via AlertsService
4. **App Mobile (foreground):** Recebe `position:update` via Socket.io, atualiza mapa
5. **App Mobile (background):** Recebe Push Notification para alertas criticos (SOS, cerca, velocidade)

---

## 4. Fluxo de Autenticacao

```
┌──────────────────────────────────────────────────────────────────┐
│                    FLUXO DE AUTENTICACAO                         │
└──────────────────────────────────────────────────────────────────┘

                         App Inicia
                             │
                             ▼
                  ┌─────────────────────┐
                  │  Verificar tokens   │
                  │  em SecureStore     │
                  └──────────┬──────────┘
                             │
                 ┌───────────┴───────────┐
                 │                       │
            Sem tokens              Tem tokens
                 │                       │
                 ▼                       ▼
          ┌────────────┐      ┌──────────────────┐
          │ Tela Login │      │ AccessToken      │
          │ Email+Senha│      │ valido? (exp)    │
          └─────┬──────┘      └────────┬─────────┘
                │                      │
                ▼               ┌──────┴──────┐
         POST /auth/login       │             │
                │              Sim           Nao
                ▼               │             │
         { accessToken,         ▼             ▼
           refreshToken }  Biometric    POST /auth/refresh
                │          Prompt       { refreshToken }
                ▼               │             │
         Salvar em          ┌───┴───┐    ┌───┴───┐
         SecureStore        │       │    │       │
                │        Sucesso  Falha  OK    Falha
                ▼           │       │    │       │
         Registrar          ▼       │    ▼       ▼
         Device Token   Dashboard   │  Biometric  Tela
         (FCM)              ▲       │  Prompt     Login
                │           │       │    │
                ▼           │       ▼    ▼
            Dashboard    ───┘   Tela    Dashboard
                                Login
```

---

## 5. Estrutura de Pastas do Monorepo

```
rastreamento-21-go/
├── turbo.json                        # Configuracao Turborepo
├── package.json                      # Workspace root (npm workspaces)
│
├── packages/
│   ├── shared-types/                 # TypeScript interfaces compartilhadas
│   │   ├── src/
│   │   │   ├── vehicle.ts            # Vehicle, VehicleWithTracking
│   │   │   ├── auth.ts               # User, LoginDto, JwtPayload
│   │   │   ├── tenant.ts             # Tenant, TenantRole
│   │   │   ├── alert.ts              # Alert, AlertType
│   │   │   ├── traccar.ts            # TraccarPosition, TraccarDevice
│   │   │   ├── geofence.ts           # Geofence, GeofenceType
│   │   │   ├── report.ts             # Trip, Stop, Position
│   │   │   ├── api.ts                # PaginatedResponse, ApiError
│   │   │   └── index.ts              # Re-exports
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── api-client/                   # Cliente HTTP tipado
│   │   ├── src/
│   │   │   ├── client.ts             # Axios/fetch instance + interceptors
│   │   │   ├── auth.ts               # login(), refresh(), me()
│   │   │   ├── vehicles.ts           # getVehicles(), getVehicle(), block()
│   │   │   ├── traccar.ts            # getPositions(), getHistory()
│   │   │   ├── alerts.ts             # getAlerts(), markRead()
│   │   │   ├── geofences.ts          # getGeofences(), create()
│   │   │   ├── reports.ts            # getTrips(), getStops(), export()
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── validation/                   # Zod schemas
│   │   ├── src/
│   │   │   ├── auth.ts               # loginSchema, registerSchema
│   │   │   ├── vehicle.ts            # createVehicleSchema, filterSchema
│   │   │   ├── geofence.ts           # geofenceSchema
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── utils/                        # Utilitarios puros
│       ├── src/
│       │   ├── geo.ts                # Haversine, ray-casting, distance
│       │   ├── format.ts             # Placa, data, velocidade, endereco
│       │   ├── constants.ts          # Roles, AlertTypes, VehicleStatus
│       │   └── index.ts
│       ├── tsconfig.json
│       └── package.json
│
├── apps/
│   ├── backend/                      # NestJS (existente, mover de backend/)
│   │   └── ...
│   │
│   ├── dashboard/                    # Next.js (existente, mover de frontend/dashboard/)
│   │   └── ...
│   │
│   └── mobile/                       # Expo React Native (NOVO)
│       ├── app/                      # expo-router (file-based routing)
│       │   ├── _layout.tsx           # Root layout (providers, fonts)
│       │   ├── (auth)/
│       │   │   ├── _layout.tsx       # Auth layout (sem navbar)
│       │   │   ├── login.tsx         # Login com email/senha
│       │   │   └── forgot.tsx        # Recuperar senha
│       │   └── (app)/
│       │       ├── _layout.tsx       # App layout (tabs + providers)
│       │       ├── (tabs)/
│       │       │   ├── _layout.tsx   # Tab navigator
│       │       │   ├── index.tsx     # Tab: Mapa (MapLibre)
│       │       │   ├── vehicles.tsx  # Tab: Lista veiculos
│       │       │   ├── alerts.tsx    # Tab: Alertas
│       │       │   └── profile.tsx   # Tab: Perfil/Config
│       │       ├── vehicle/
│       │       │   ├── [id].tsx      # Detalhe do veiculo
│       │       │   └── [id]/
│       │       │       └── history.tsx # Historico de rotas
│       │       ├── scanner.tsx       # QR Scanner (IMEI)
│       │       ├── geofences.tsx     # Lista geofences
│       │       ├── reports.tsx       # Relatorios
│       │       └── settings.tsx      # Configuracoes
│       ├── components/
│       │   ├── map/
│       │   │   ├── MapView.tsx       # MapLibre GL wrapper
│       │   │   ├── VehicleMarker.tsx # Marker com direcao
│       │   │   ├── RoutePolyline.tsx # Polyline de rota
│       │   │   └── GeofenceLayer.tsx # Poligonos/circulos
│       │   ├── vehicles/
│       │   │   ├── VehicleCard.tsx   # Card na lista
│       │   │   ├── VehicleDetail.tsx # Painel de detalhes
│       │   │   └── FilterBar.tsx     # Filtros online/offline/alerta
│       │   ├── alerts/
│       │   │   ├── AlertCard.tsx     # Card de alerta
│       │   │   └── AlertBadge.tsx    # Badge de contagem
│       │   ├── auth/
│       │   │   ├── LoginForm.tsx     # Formulario de login
│       │   │   └── BiometricButton.tsx # Botao biometria
│       │   └── ui/                   # Componentes base (NativeWind)
│       │       ├── Button.tsx
│       │       ├── Input.tsx
│       │       ├── Card.tsx
│       │       └── Badge.tsx
│       ├── stores/
│       │   ├── auth.store.ts         # AuthStore (Zustand + MMKV)
│       │   ├── tracking.store.ts     # TrackingStore (posicoes, socket)
│       │   ├── vehicle.store.ts      # VehicleStore (lista, filtros)
│       │   └── alert.store.ts        # AlertStore (notificacoes)
│       ├── services/
│       │   ├── socket.service.ts     # Singleton Socket.io
│       │   ├── notification.service.ts # FCM registration + handlers
│       │   ├── ble.service.ts        # Bluetooth diagnostico
│       │   └── offline.service.ts    # WatermelonDB sync
│       ├── hooks/
│       │   ├── useAuth.ts            # Auth state + biometric
│       │   ├── useTracking.ts        # Real-time positions
│       │   ├── useVehicle.ts         # Vehicle CRUD
│       │   └── useAlerts.ts          # Alerts + push
│       ├── config/
│       │   ├── app.config.ts         # Expo config (env vars, flavors)
│       │   └── flavors/
│       │       ├── admin.ts          # Bundle ID, nome, icone Admin
│       │       └── client.ts         # Bundle ID, nome, icone Cliente
│       ├── assets/                   # Icones, imagens, fontes
│       ├── app.json                  # Expo config
│       ├── eas.json                  # EAS Build config
│       ├── metro.config.js           # Metro bundler (monorepo)
│       ├── nativewind-env.d.ts       # NativeWind types
│       ├── tailwind.config.ts        # Tailwind config
│       ├── tsconfig.json
│       └── package.json
│
├── docker/                           # Docker Compose (existente)
├── docs/                             # Documentacao (este arquivo)
├── skills/                           # Claude Code skills
└── CLAUDE.md                         # Instrucoes do projeto
```

---

## 6. Build Variants (Flavors) — Admin vs Cliente

```
┌──────────────────────────────────────────────────────────┐
│                    CODEBASE UNICO                        │
│                    apps/mobile/                           │
├──────────────────────────┬───────────────────────────────┤
│      FLAVOR: ADMIN       │       FLAVOR: CLIENT          │
├──────────────────────────┼───────────────────────────────┤
│ Bundle ID:               │ Bundle ID:                    │
│ com.r21go.admin          │ com.r21go.client              │
│                          │                               │
│ Nome: "21 GO Admin"      │ Nome: "21 GO Rastreamento"    │
│                          │                               │
│ Icone: Icone admin       │ Icone: Icone cliente          │
│                          │                               │
│ Roles: SUPER_ADMIN,      │ Roles: VIEWER                 │
│        ADMIN, OPERATOR   │                               │
│                          │                               │
│ Features:                │ Features:                     │
│ ✓ Todos os veiculos      │ ✓ Apenas seus veiculos        │
│ ✓ Bloqueio remoto        │ ✓ Mapa + detalhes             │
│ ✓ QR Scanner IMEI        │ ✓ Historico de rotas          │
│ ✓ Comandos SMS           │ ✓ Alertas personalizados      │
│ ✓ Gestao chips M2M       │ ✓ Botao resgate               │
│ ✓ BLE diagnostico        │ ✓ Boletos e pagamentos        │
│ ✓ Historico + relatorios │ ✓ Modo panico                 │
│ ✓ Geofences CRUD         │ ✓ Compartilhar localizacao    │
│ ✓ Cadastro rastreadores  │ ✓ Notificacoes push           │
│ ✓ Alertas operacionais   │                               │
├──────────────────────────┴───────────────────────────────┤
│                    CODIGO COMPARTILHADO                   │
│                                                          │
│  ✓ Autenticacao (JWT, biometria, auto-login)             │
│  ✓ MapLibre GL (mapa, markers, polylines)                │
│  ✓ Socket.io (real-time positions)                       │
│  ✓ Push Notifications (FCM)                              │
│  ✓ Offline storage (WatermelonDB, MMKV)                  │
│  ✓ Componentes UI base (NativeWind)                      │
│  ✓ API Client (shared package)                           │
│  ✓ Types, Validation, Utils (shared packages)            │
└──────────────────────────────────────────────────────────┘
```

### Implementacao de Flavors

```typescript
// config/flavors/admin.ts
export const adminFlavor = {
  name: '21 GO Admin',
  slug: 'r21go-admin',
  bundleId: {
    ios: 'com.r21go.admin',
    android: 'com.r21go.admin',
  },
  icon: './assets/icon-admin.png',
  splash: './assets/splash-admin.png',
  features: {
    vehicleManagement: true,
    remoteBlock: true,
    qrScanner: true,
    smsCommands: true,
    bleDebug: true,
    chipManagement: true,
    reports: true,
    geofenceCRUD: true,
    trackerRegistration: true,
  },
  roles: ['SUPER_ADMIN', 'ADMIN', 'OPERATOR'],
};

// config/flavors/client.ts
export const clientFlavor = {
  name: '21 GO Rastreamento',
  slug: 'r21go-client',
  bundleId: {
    ios: 'com.r21go.client',
    android: 'com.r21go.client',
  },
  icon: './assets/icon-client.png',
  splash: './assets/splash-client.png',
  features: {
    vehicleManagement: false,
    remoteBlock: false,
    qrScanner: false,
    smsCommands: false,
    bleDebug: false,
    chipManagement: false,
    reports: false,
    geofenceCRUD: false,
    trackerRegistration: false,
    panic: true,
    rescue: true,
    billing: true,
    shareLocation: true,
  },
  roles: ['VIEWER'],
};
```

---

## 7. Estrategia de Push Notifications

```
┌─────────────────────────────────────────────────────────┐
│                    BACKEND (NestJS)                      │
│                                                         │
│  AlertsService.processPosition()                        │
│       │                                                 │
│       ▼                                                 │
│  Detectou alerta? ──Sim──▶ Salvar no banco (Alert)     │
│       │                         │                       │
│       │                         ▼                       │
│       │              NotificationsService               │
│       │                    │                            │
│       │         ┌──────────┴──────────┐                │
│       │         │                     │                │
│       │    Socket.io              Firebase Admin        │
│       │    (foreground)           (background)          │
│       │         │                     │                │
│       │    position:update       admin.messaging()     │
│       │    alert:new             .send({ token, ... }) │
│       │         │                     │                │
└───────┼─────────┼─────────────────────┼─────────────────┘
        │         │                     │
        │         ▼                     ▼
        │  ┌──────────────┐    ┌──────────────┐
        │  │ App Foreground│    │ FCM / APNs   │
        │  │ Atualiza mapa │    │ Push Notif   │
        │  │ + toast alert │    │ Badge + Som  │
        │  └──────────────┘    └──────────────┘
```

### Tipos de Notificacao

| Tipo de Alerta | Prioridade | Foreground | Background |
|---|---|---|---|
| SOS / Panico | Critica | Toast + Som | Push Alta Prioridade |
| Geofence (entrada/saida) | Alta | Toast | Push |
| Velocidade excessiva | Alta | Toast | Push |
| Ignicao ON/OFF | Normal | Badge update | Push silencioso |
| Bateria baixa | Normal | Badge update | Push silencioso |
| Offline | Baixa | Badge update | Push agrupado |

---

## 8. Estrategia Offline-First

```
┌─────────────────────────────────────────────────────────┐
│                    ONLINE (Normal)                       │
│                                                         │
│  API Client ◀───────────▶ Backend NestJS                │
│      │                                                  │
│      ▼                                                  │
│  WatermelonDB (cache local)                             │
│  MMKV (key-value rapido)                                │
│                                                         │
│  Socket.io ◀────────────▶ Backend WebSocket             │
│      │                                                  │
│      ▼                                                  │
│  UI atualiza em tempo real                              │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    OFFLINE (Sem rede)                    │
│                                                         │
│  UI renderiza dados do WatermelonDB (cache)             │
│  ├── Lista de veiculos (ultima sync)                    │
│  ├── Ultima posicao conhecida de cada veiculo           │
│  ├── Historico de rotas (ja baixados)                   │
│  ├── Alertas anteriores                                 │
│  └── Geofences configuradas                             │
│                                                         │
│  Acoes offline ficam em fila:                           │
│  ├── Marcar alerta como lido                            │
│  ├── Configurar preferencias                            │
│  └── (Bloqueio remoto NAO funciona offline - esperado)  │
│                                                         │
│  Banner: "Voce esta offline. Dados podem estar          │
│           desatualizados."                               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    RECONEXAO (Rede volta)                │
│                                                         │
│  1. WatermelonDB.sync()                                 │
│     ├── pullChanges(lastSyncedAt) → backend             │
│     └── pushChanges(localChanges) → backend             │
│                                                         │
│  2. Socket.io reconecta automaticamente                 │
│     └── Resume do stream de posicoes                    │
│                                                         │
│  3. Processar fila de acoes offline                     │
│                                                         │
│  4. Atualizar UI com dados frescos                      │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Diagrama de Dependencias (Pacotes)

```
                    ┌─────────────────┐
                    │  shared-types   │  ← TypeScript puro
                    │  (sem deps)     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
      ┌──────────────┐ ┌──────────┐ ┌──────────────┐
      │  validation  │ │  utils   │ │  api-client  │
      │  (zod)       │ │  (puro)  │ │  (axios)     │
      └──────────────┘ └──────────┘ └──────┬───────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
      ┌──────────────┐ ┌──────────┐ ┌──────────────┐
      │  dashboard   │ │  mobile  │ │  backend     │
      │  (Next.js)   │ │  (Expo)  │ │  (NestJS)    │
      └──────────────┘ └──────────┘ └──────────────┘
```

---

## 10. Seguranca

### Armazenamento de Credenciais

| Dado | Storage | Encriptacao |
|---|---|---|
| Access Token (JWT) | expo-secure-store | iOS Keychain / Android Keystore |
| Refresh Token | expo-secure-store | iOS Keychain / Android Keystore |
| Preferencias do usuario | MMKV (encriptado) | AES-256 |
| Cache de veiculos | WatermelonDB | SQLite (nao encriptado) |
| Biometric enrollment | expo-local-authentication | Hardware-backed |

### Checklist de Seguranca

- [ ] Tokens JWT nunca em AsyncStorage (sem encriptacao)
- [ ] Refresh Token Rotation implementado
- [ ] Certificate Pinning para api.trackgo.site (producao)
- [ ] Biometria como conveniencia, nao como auth primaria
- [ ] Logs sensiveis removidos em producao (sem tokens em console.log)
- [ ] ProGuard/R8 habilitado no Android (ofuscacao)
- [ ] App Transport Security no iOS (HTTPS only)
- [ ] Timeout de sessao (inatividade > 30min = re-auth)

---

## 11. Stack Tecnica Completa

| Camada | Tecnologia | Versao | Uso |
|---|---|---|---|
| Runtime | Expo SDK | 53 | Framework mobile |
| Engine | React Native | 0.79 | Bridge nativa |
| UI Framework | React | 19 | Componentes |
| Linguagem | TypeScript | 5.x | Strict mode |
| Navegacao | expo-router | v4 | File-based routing |
| Estilos | NativeWind | v4 | Tailwind no mobile |
| Estado | Zustand | 5.x | State management |
| Mapas | @maplibre/maplibre-react-native | v11 | Mapa em tempo real |
| Real-time | socket.io-client | 4.8 | WebSocket |
| Push | @react-native-firebase/messaging | 24.0 | FCM |
| Auth Storage | expo-secure-store | 55.0 | Keychain/Keystore |
| KV Storage | react-native-mmkv | 4.3 | Prefs rapidas |
| Offline DB | WatermelonDB | Latest | Cache relacional |
| Biometria | expo-local-authentication | 55.0 | Face ID/Fingerprint |
| Camera/QR | expo-camera | 55.0 | Scan IMEI |
| Bluetooth | react-native-ble-plx | 3.5 | Diagnostico trackers |
| Location | expo-location | 55.0 | GPS (se necessario) |
| Contacts | expo-contacts | 55.0 | Compartilhar loc. |
| HTTP | axios | 1.x | Via api-client pkg |
| Validation | zod | 3.x | Via validation pkg |
| Monorepo | Turborepo | Latest | Build orchestration |
| Build | EAS Build | Latest | Cloud builds |
| Updates | EAS Update | Latest | OTA updates |
