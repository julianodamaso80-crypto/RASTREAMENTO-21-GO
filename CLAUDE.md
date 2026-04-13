# Rastreamento 21 GO

Plataforma multi-tenant de rastreamento veicular em tempo real com gestão de frotas, alertas, geofencing, relatórios e integração com Hinova SGA. Hospedada em DigitalOcean + EasyPanel (Docker Swarm + Traefik).

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TailwindCSS, shadcn/ui, MapLibre GL JS, Socket.io-client |
| Backend | NestJS 11, Prisma, Passport JWT, Socket.io, Pino, class-validator |
| Motor GPS | Traccar 6.5 (REST + WebSocket) |
| Banco | PostgreSQL 17 |
| Cache | Redis 7 |
| Infra | Docker Swarm + Traefik via EasyPanel (prod) / Docker Compose (dev) |

## Como rodar (local)

```bash
docker compose -f docker/docker-compose.yml up -d
cd backend && npm install && npx prisma generate && npx prisma migrate dev && npx prisma db seed && npm run start:dev
cd frontend/dashboard && npm install && npm run dev
```

| Serviço | URL local |
|---|---|
| Frontend | http://localhost:3000 |
| Backend | http://localhost:3001 |
| Swagger | http://localhost:3001/api/docs |
| Traccar | http://localhost:8082 |

Credenciais dev (seed): `admin@rastreamento21go.com.br` / `admin123`.

## Onde encontrar cada coisa

| Tópico | Arquivo |
|---|---|
| Referência técnica (módulos, endpoints, WebSocket, schema) | [skills/rastreamento-21-go/SKILL.md](skills/rastreamento-21-go/SKILL.md) |
| Deploy, produção, runbook, credenciais | [docs/DEPLOY.md](docs/DEPLOY.md) |
| Decisões arquiteturais (ADRs) | [docs/DECISIONS.md](docs/DECISIONS.md) |
| Padrões, convenções, regras de código | [docs/CONVENTIONS.md](docs/CONVENTIONS.md) |
| Apps mobile (planejamento) | [docs/mobile-app-research.md](docs/mobile-app-research.md), [docs/mobile-app-architecture.md](docs/mobile-app-architecture.md), [docs/mobile-app-roadmap.md](docs/mobile-app-roadmap.md) |

## Regras críticas (nunca ignorar)

1. **Multi-tenant.** Toda query backend filtra por `tenantId`. Sem exceção — mesmo `findFirst`/`findUnique`. O `tenantId` vem do JWT via `TenantGuard` (`req.tenantId`).
2. **DNS `gps1`/`gps2` com proxy Cloudflare OFF.** Rastreadores GT06/Suntech/etc. usam TCP raw nas portas 5001–5055; proxy Cloudflare só repassa HTTP/HTTPS. Ver [ADR-004](docs/DECISIONS.md).
3. **Templates SMS usam DNS hostname, não IP raw.** `SERVER,1,gps1.trackgo.site,5023,0#`, não `SERVER,1,167.71.31.77,5023,0#`. Assim trocar de servidor não exige reconfigurar rastreadores em campo. Ver [ADR-005](docs/DECISIONS.md).
4. **Nomenclatura dos services em produção.** Todos com sufixo `-rastreamento`: `backend-rastreamento`, `postgres-rastreamento`, etc. Ver [ADR-002](docs/DECISIONS.md).
5. **Roles em INGLÊS, UI em PT-BR.** Enums no código (`SUPER_ADMIN`, `ADMIN`, `OPERATOR`, `VIEWER`) ficam em inglês; labels visíveis ao usuário são traduzidos via mapas. Mesma regra para `DeviceStatus`, `AlertType`, etc.
6. **Rotas frontend em PT-BR, rotas backend em inglês.** `/dispositivos`, `/alertas`, `/configuracoes` no dashboard. `/api/v1/devices`, `/api/v1/alerts` na API.
7. **Nunca commitar segredos.** Senhas, tokens, JWT secrets, chaves privadas e connection strings completas ficam no 1Password + EasyPanel env vars. DEPLOY.md documenta **nomes** das credenciais, nunca valores.
8. **Soft delete sempre.** Models com `deletedAt`. Nunca `delete()` físico.
9. **Imports do Prisma Client.** Usar `.prisma/client` (não `@prisma/client`) — workaround documentado em [CONVENTIONS.md §9](docs/CONVENTIONS.md).

## Estado atual (2026-04-13)

- Produção no ar: `trackgo.site`, `api.trackgo.site`, `traccar.trackgo.site`, `painel.trackgo.site`.
- Rastreadores em `gps1.trackgo.site:5023` (GT06/J16) e `gps2.trackgo.site:5023` (backup).
- Hinova em modo mock (`HINOVA_MOCK=true`) — credenciais reais ainda não obtidas.
- Apps mobile: planejados, não iniciados.
- Deploy: manual via SSH + `docker build` + `docker service update`. Sem CI/CD ainda.
