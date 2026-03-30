# Rastreamento 21 GO

Plataforma de rastreamento veicular com mapa em tempo real, gestão de frotas e integração com Hinova SGA.

## Como rodar

```bash
# Subir infraestrutura (Traccar, PostgreSQL, Redis, Nginx)
docker compose -f docker/docker-compose.yml up -d

# Backend (em outro terminal)
cd backend && npm install && npm run start:dev

# Frontend (em outro terminal)
cd frontend/dashboard && npm install && npm run dev
```

## Serviços

| Serviço    | URL                        | Descrição                          |
|------------|----------------------------|------------------------------------|
| Frontend   | http://localhost:3000      | Dashboard Next.js                  |
| Backend    | http://localhost:3001      | API NestJS                         |
| Swagger    | http://localhost:3001/api/docs | Documentação da API             |
| Traccar    | http://localhost:8082      | Servidor de rastreamento           |
| PostgreSQL | localhost:5432             | Banco de dados                     |
| Redis      | localhost:6379             | Cache e filas                      |
| Nginx      | http://localhost:80        | Reverse proxy (produção)           |

## Stack

- **Frontend:** Next.js 14+, TypeScript, TailwindCSS, MapLibre GL JS, shadcn/ui
- **Backend:** NestJS, TypeScript, Prisma ORM, Socket.io
- **Rastreamento:** Traccar 6.5
- **Banco:** PostgreSQL 16
- **Cache:** Redis 7
- **Integração:** Hinova SGA (mock em desenvolvimento)
