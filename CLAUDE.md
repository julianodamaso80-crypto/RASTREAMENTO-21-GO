# Rastreamento 21 GO

Plataforma de rastreamento veicular com mapa em tempo real, gestão de frotas e integração com Hinova SGA.

## Stack

- **Frontend:** Next.js 14+ (App Router), TypeScript strict, TailwindCSS, shadcn/ui, MapLibre GL JS, Socket.io-client
- **Backend:** NestJS, TypeScript strict, Prisma ORM, Socket.io, Passport JWT
- **Rastreamento:** Traccar 6.5 (API REST + WebSocket)
- **Banco:** PostgreSQL 16 (via Docker)
- **Cache:** Redis 7 (via Docker)
- **Integração:** Hinova SGA (mock em desenvolvimento, sem credenciais ainda)
- **Infra:** Docker Compose local

## Convenções

- **Código em inglês** (nomes de variáveis, funções, classes, arquivos)
- **UI e mensagens para o usuário em português BR**
- **Comentários podem ser em português**
- TypeScript strict em todos os projetos
- Prisma como ORM (backend)
- Toda rota autenticada com JWT (exceto login)
- Multi-tenant: todas as queries filtram por `tenantId`
- Respostas paginadas: `{ data: [], meta: { total, page, perPage } }`
- DTOs com class-validator para toda entrada no backend
- Logs estruturados com Pino

## Estrutura do Monorepo

```
rastreamento-21-go/
├── docker/              # Docker Compose + configs (Traccar, Nginx, PostgreSQL)
├── backend/             # NestJS API
│   ├── src/modules/     # auth, traccar, vehicles, tenants, hinova, alerts
│   └── prisma/          # Schema e migrations
├── frontend/dashboard/  # Next.js dashboard
└── package.json         # Workspace root
```

## Comandos

```bash
# Infraestrutura
docker compose -f docker/docker-compose.yml up -d    # Subir serviços
docker compose -f docker/docker-compose.yml down      # Parar serviços

# Backend
cd backend && npm run start:dev                       # Dev server (porta 3001)
cd backend && npx prisma migrate dev                  # Rodar migrations
cd backend && npx prisma db seed                      # Seed do banco

# Frontend
cd frontend/dashboard && npm run dev                  # Dev server (porta 3000)
```

## URLs de Desenvolvimento

| Serviço  | URL                          |
|----------|------------------------------|
| Frontend | http://localhost:3000         |
| Backend  | http://localhost:3001         |
| Swagger  | http://localhost:3001/api/docs|
| Traccar  | http://localhost:8082         |

## Notas

- Hinova SGA: sem credenciais ainda, usar `HINOVA_MOCK=true` no .env
- Traccar admin padrão: admin@rastreamento21go.com.br / admin123
- Abordagem MVP: funcional primeiro, polir depois
