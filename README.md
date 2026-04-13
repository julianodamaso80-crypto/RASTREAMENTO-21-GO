# Rastreamento 21 GO

Plataforma multi-tenant de rastreamento veicular em tempo real: mapa ao vivo, gestão de frotas, alertas, geofencing, relatórios, comandos SMS para rastreadores e integração com Hinova SGA.

Em produção: **https://trackgo.site** · API: `api.trackgo.site` · Traccar: `traccar.trackgo.site`.

## Como rodar localmente

```bash
# 1. Infraestrutura local (PostgreSQL, Redis, Traccar)
docker compose -f docker/docker-compose.yml up -d

# 2. Backend
cd backend && npm install && npx prisma generate && npx prisma migrate dev && npx prisma db seed && npm run start:dev

# 3. Frontend (outro terminal)
cd frontend/dashboard && npm install && npm run dev
```

Credenciais dev (seed): `admin@rastreamento21go.com.br` / `admin123`.

## URLs locais

| Serviço | URL | Descrição |
|---|---|---|
| Frontend | http://localhost:3000 | Dashboard Next.js |
| Backend | http://localhost:3001 | API NestJS |
| Swagger | http://localhost:3001/api/docs | Documentação OpenAPI |
| Traccar | http://localhost:8082 | Servidor de rastreamento |

## Stack

- **Frontend:** Next.js 16 (App Router), React 19, TailwindCSS, shadcn/ui, MapLibre GL JS, Socket.io-client
- **Backend:** NestJS 11, Prisma, Passport JWT, Socket.io, Pino, class-validator
- **Motor GPS:** Traccar 6.5 (REST + WebSocket)
- **Banco:** PostgreSQL 17
- **Cache:** Redis 7
- **Integração:** Hinova SGA (mock em dev)
- **Infra prod:** Docker Swarm + Traefik via EasyPanel em DigitalOcean
- **Infra dev:** Docker Compose local

## Documentação

| Tópico | Arquivo |
|---|---|
| Quick start + regras críticas | [CLAUDE.md](CLAUDE.md) |
| Referência técnica de dev | [skills/rastreamento-21-go/SKILL.md](skills/rastreamento-21-go/SKILL.md) |
| Deploy, runbook, credenciais | [docs/DEPLOY.md](docs/DEPLOY.md) |
| Decisões arquiteturais (ADRs) | [docs/DECISIONS.md](docs/DECISIONS.md) |
| Convenções e padrões | [docs/CONVENTIONS.md](docs/CONVENTIONS.md) |
| Apps mobile (planejamento) | [docs/mobile-app-research.md](docs/mobile-app-research.md) |
