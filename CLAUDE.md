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

## O que já funciona hoje (verificado em código — 2026-04-20)

**Rastreamento end-to-end operacional**: GPS físico → Traccar 6.5 → backend NestJS → WebSocket Socket.io → mapa no dashboard. Rastreadores reais emitindo pra `gps1.trackgo.site:5023` (GT06/J16).

| Capacidade | Status | Evidência |
|---|---|---|
| Multi-tenant com guard global | ✓ | [tenant.guard.ts](backend/src/common/guards/tenant.guard.ts) aplicado em [app.module.ts](backend/src/app.module.ts) |
| Traccar REST + WebSocket consumido | ✓ | [traccar.service.ts](backend/src/modules/traccar/traccar.service.ts), [traccar.gateway.ts](backend/src/modules/traccar/traccar.gateway.ts) |
| Mapa em tempo real (MapLibre) | ✓ | [map-container.tsx](frontend/dashboard/src/components/map/map-container.tsx) |
| Dashboard de conectividade (total, online, offline, +24h) | ✓ | [dashboard.service.ts](backend/src/modules/dashboard/dashboard.service.ts) |
| Geofencing polígono + círculo com alertas IN/OUT | ✓ | [geofences.service.ts](backend/src/modules/geofences/geofences.service.ts) |
| Alertas (SPEED, IGNITION, SOS, BATTERY, OFFLINE, GEOFENCE) | ◐ | enum em [schema.prisma](backend/prisma/schema.prisma); limites hardcoded, sem config por usuário |
| Histórico de viagens (rota, paradas, velocidade) | ✓ | [reports.service.ts](backend/src/modules/reports/reports.service.ts) |
| Relatórios + export XLSX/CSV | ✓ | [reports.controller.ts](backend/src/modules/reports/reports.controller.ts) |
| Gestão de Chips (CRUD, operadora, vínculo a device) | ✓ | [chips.service.ts](backend/src/modules/chips/chips.service.ts) |
| Técnicos: cadastro + senha provisória, reserva de equipamento em lote, PWA de campo | ✓ | [technicians.service.ts](backend/src/modules/technicians/technicians.service.ts), [tech-field.service.ts](backend/src/modules/tech/tech-field.service.ts), [/tecnico](frontend/dashboard/src/app/tecnico/page.tsx) |
| Gestão de Veículos | ◐ | [vehicles.service.ts](backend/src/modules/vehicles/vehicles.service.ts) — falta grupos, âncora, odômetro, foto, ícone |
| SMS Comandos com templates por modelo | ◐ | [sms-commands.service.ts](backend/src/modules/sms-commands/sms-commands.service.ts) — sem favoritos, sem saldo |
| Hinova SGA | ◐ MOCK | [hinova.service.ts](backend/src/modules/hinova/hinova.service.ts) — `HINOVA_MOCK=true` |
| E-mail transacional (Resend) | ◐ | [email.service.ts](backend/src/modules/email/email.service.ts) — hoje só reset de senha |

## Visão competitiva — como vamos ficar melhor

**Referência:** RedeVeiculos.com (instância `21go.rastreamento.vip`, 22.521 ativos). Auditoria 20/04/2026.

**Diagnóstico (verificado, sem achismo):**

- **Stack:** já ganhamos. Next.js 16 + React 19 + NestJS 11 + Prisma + TypeScript. Concorrente roda jQuery 3.7 + Bootstrap 5 + PHP MVC por query string (`?acao=...`). Code base deles é estilo 2015.
- **Core de rastreamento:** empate. Ambos mostram posição no mapa, processam alerta, geram relatório, enviam SMS.
- **Maturidade operacional:** perdemos. Eles tiveram 24 releases major (v5→v24) e montaram workflows que ainda não temos: Guardião, tratativa de alertas, agendamentos com OS digital, antifraude cross-tenant, sub-empresas.

**Placar da auditoria (44 features avaliadas):**

| Status | Qtd | % |
|---|---|---|
| ✓ Implementado no 21 GO | 12 | 27% |
| ◐ Parcial | 10 | 23% |
| ✗ Faltando | 22 | 50% |

**Onde vamos ganhar depois do roadmap:**
1. Mesma profundidade operacional **em stack moderna** — UX melhor, performance maior, código manutenível.
2. IA nativa feita certo (Claude consultando DB do tenant via tool use) — não wrapper de FAQ como eles.
3. Apps mobile em React Native compartilhando types/validators com o dashboard (monorepo).
4. Custo de operação menor → preço competitivo sem sacrificar margem.

**Features do concorrente que NÃO vamos copiar** (avaliadas e descartadas):
- Cashback 0,5% → política comercial, não feature.
- Clube Rede de benefícios → parceria, não software.
- TAG Bluetooth tipo AirTag → hardware; revenda se fizer sentido comercial.
- Assistente IA como wrapper de FAQ → fazemos IA útil ou nenhuma.
- Espelhamento pra outra plataforma → ninguém usa.
- Migração de ativos entre empresas → edge case raro.

## Roadmap — passo a passo em 3 waves

Priorizado por **utilidade operacional real** > polimento > marketing. Escopo, arquivo-alvo e critério de aceitação em cada item. Estimativas são ordem de grandeza — validar em kick-off de cada wave.

### Wave 1 — Fundação operacional (4–6 semanas)

Estancar déficits arquiteturais que travam venda B2B séria.

**1.1 Soft delete universal** — 2d
- Adicionar `deletedAt DateTime?` em: User, Tenant, Alert, Geofence, Associate no [schema.prisma](backend/prisma/schema.prisma)
- Middleware Prisma global que filtra `deletedAt: null`
- Aceite: nenhum `.delete()` físico no código; restore testado

**1.2 Workflow de Alerta** — 5d
- Expandir model Alert: `status` (OPEN/IN_PROGRESS/RESOLVED), `assignedToId`, `resolvedAt`, `resolution`
- Novo model AlertHistory (userId, action, timestamp, comment)
- Endpoints: assume / resolve / reopen / comment em [alerts.controller.ts](backend/src/modules/alerts/alerts.controller.ts)
- UI de tratativa na rota `/alertas`
- Aceite: SOS gerado → operador assume → resolve com observação → histórico auditável

**1.3 Auditoria de ações (AuditLog)** — 3d
- Model AuditLog (userId, tenantId, action, entity, entityId, before, after, ip, userAgent, createdAt)
- Interceptor NestJS global para operações de escrita
- Tela de consulta restrita a SUPER_ADMIN/ADMIN
- Aceite: toda escrita deixa rastro, exportável em XLSX

**1.4 Permissões granulares + IP binding + expiração** — 5d
- Model Permission e UserPermission (N:N)
- Campos `allowedIps String[]` e `expiresAt DateTime?` em User
- Guard que bloqueia fora do IP permitido ou após expiração
- Matriz Role→Permissions default, override por usuário
- Aceite: usuário com IP fixo + expiração testado (acesso negado após data)

**1.5 Finalizar Hinova real** — 3d (depende de credenciais)
- Remover `HINOVA_MOCK=true`, validar autenticação real
- Agendar `hinova-sync.service` com `@nestjs/schedule` (cron)
- Aceite: associado real da Hinova aparece no 21 GO sem intervenção manual

### Wave 2 — Maturidade de produto (8–12 semanas)

Paridade operacional nas features que vendem.

**2.1 Guardião — motor de silêncio** — 10d
- Model GuardianConfig (tenantId, vehicleType, gprsIntervalHours, gpsIntervalHours — 8h a 7d)
- Job BullMQ + Redis rodando a cada 15min, marca ativos silenciosos
- Model GuardianOccurrence (vehicleId, detectedAt, lastCommAt, status, assignedToId, notes)
- PDF consolidado (pdfkit ou puppeteer) enviado por e-mail a cada 4h via Resend
- UI com abas A Tratar / Tratados / Desabilitados
- Aceite: ativo offline por X horas → entra em "A Tratar" → PDF chega no contato configurado

**2.2 Agendamentos + Ordens de Serviço** — 15d
- Models: Appointment, ServiceOrder, ChecklistTemplate, ChecklistAnswer, AppointmentPhoto
- Calendário com `react-big-calendar` ou `@fullcalendar/react`
- Checklist digital por tipo de serviço (instalação, manutenção, retirada)
- Upload de fotos via FilePond → DigitalOcean Spaces (S3-compatible)
- Link público de auto-agendamento por tipo de serviço (token assinado)
- Contrato com aceite por e-mail (link assinado)
- Aceite: agendar instalação → técnico abre OS → preenche checklist → sobe fotos → cliente aceita contrato por e-mail → OS fechada

**2.3 Mapa — cluster, Street View, replay, multi-layer** — 7d
- Clustering com `@mapbox/supercluster`
- Street View: Mapillary (open) ou Google Street View
- Replay de rota: slider de timestamp com `@turf/along` pra interpolação
- Camadas: Relevo / Satélite / Trânsito / Básico / Noite (troca de tile URL)
- Busca em lote por lista de IMEIs colados (textarea → split → query)
- Aceite: selecionar 100+ ativos vê clusters; replay de viagem de 2h funciona suave

**2.4 Sub-empresas (matriz/filial)** — 5d
- Campo `parentTenantId String?` em Tenant no [schema.prisma](backend/prisma/schema.prisma)
- TenantGuard respeita hierarquia: matriz lê dados das filhas, filial não lê matriz
- Aceite: matriz vê ocorrências do Guardião das sub-empresas; filial não vê dados da matriz

**2.5 Fuso horário por empresa e usuário** — 3d
- Campo `timezone String` (IANA, default `America/Sao_Paulo`) em Tenant e User
- Hierarquia: User.timezone > Tenant.timezone > default
- Frontend formata com date-fns-tz
- Aceite: usuário em `America/Manaus` vê horas deslocadas corretamente em todas as telas

### Wave 3 — Diferenciais e crescimento (12+ semanas)

Só começa quando Wave 1+2 estiverem estáveis em produção.

**3.1 Antifraude intra-tenant** — 7d
- Busca por CPF/CNPJ, Placa, Chassi duplicados dentro do tenant
- Ícone de alerta nas telas de Cliente e Ativo
- Export de relatório

**3.2 Antifraude cross-tenant (opt-in LGPD)** — 10d
- Flag `shareAntifraudData Boolean` em Tenant (consentimento explícito)
- Endpoint busca em tenants que optaram
- Resposta mostra só contagem ("encontrado em 2 empresas"), nunca nome
- Aceite: só tenants com flag=true participam; compliance LGPD documentada

**3.3 Carteira Virtual** — 10d
- Models: Wallet, WalletTransaction (type, amount, description, reference)
- Integração Pix/boleto (Asaas, Gerencianet ou Stripe BR)
- Webhook de confirmação
- Consumo de saldo em SMS Comando e Consulta de Placa
- UI: saldo + histórico + recarga

**3.4 Consulta de placas nacional** — 5d
- API paga (Olho no Carro, SINESP Cidadão ou similar)
- Cobrança pela Carteira Virtual
- Cache por 30 dias

**3.5 Assistente IA — feito certo** — 10d
- Claude Sonnet 4.6 via Anthropic SDK
- Tool use: `query_vehicles`, `query_alerts`, `summarize_trips`, `explain_geofence`
- Contexto isolado por tenant (RAG sobre dados do próprio tenant)
- Prompt caching agressivo (CLAUDE.md compilado + schema Prisma)
- Aceite: "quantos veículos estão offline há mais de 6h?" → lista com placas, não papo furado

**3.6 White-label completo** — 7d
- CSS vars injetadas por tenant (cores)
- Logo de login, logo header, favicon customizados
- Subdomínio customizado (DNS + Traefik labels dinâmicas)
- E-mail com remetente do tenant (Resend + domínio verificado)

**3.7 Estoque de equipamentos** — 8d
- Model Equipment (distinto de Device): serialNumber, model, status (AVAILABLE/ASSIGNED/IN_MAINTENANCE/LOST), assignedTechnicianId
- Model EquipmentMovement (in/out, date, technician, notes)
- Dashboard com donut por status + barras por situação + gráfico por técnico
- Operações em lote

**3.8 Apps mobile (React Native + Expo)** — 16 semanas
- Conforme [docs/mobile-app-roadmap.md](docs/mobile-app-roadmap.md)
- Monorepo com types/validators compartilhados com dashboard
- App cliente: veículos, alertas, pagamentos
- App técnico: OS, checklist, fotos, avaliação

---

**Resumo em números após completar as 3 waves:**
- 12 features ✓ hoje → 42 features ✓ (paridade operacional + diferenciais próprios)
- 22 gaps descobertos na auditoria → 6 descartados estrategicamente + 16 entregues
- Stack moderna mantida, débito técnico resolvido (soft delete, auditoria, permissões)

## Estado atual (2026-05-19)

- Produção no ar: `trackgo.site` / `www.trackgo.site` (dashboard), `api.trackgo.site` (backend REST/WS), `traccar.trackgo.site` (Traccar UI).
- ⚠️ `painel.trackgo.site` está com DNS no Cloudflare mas SEM rota Traefik nem cert — retorna 404. Era pra ser o admin UI do EasyPanel; ainda não configurado. Acesso EasyPanel hoje só via IP do droplet.
- Rastreamento **funcionando end-to-end** com rastreadores reais em `gps1.trackgo.site:5023` (GT06/J16) e `gps2.trackgo.site:5023` (backup).
- Wave 2.5 (análise comportamental do rastreador) **em prod**: Position seletiva, TenantSettings, BehaviorCard, sabotagem (powerCut/jamming), bateria carro fraca, condução brusca (HARSH_BRAKE/ACCEL), telemetria, manutenção preditiva (cron 4h), score de motorista (cron 5h, ranking), Assistente IA (OpenRouter + tool use, isolamento por tenant).
- Hinova em modo mock (`HINOVA_MOCK=true`, `HINOVA_SYNC_ENABLED=false`) — credenciais reais ainda não obtidas. Cron de sync DESLIGADO em prod pra não criar fantasmas.
- Apps mobile: planejados ([docs/mobile-app-roadmap.md](docs/mobile-app-roadmap.md)), não iniciados.
- Deploy: manual via SSH + `docker build` + `tag + push pro registry localhost:5000` + `docker service update`. Build do backend agora carrega `GIT_SHA`/`BUILD_TIME` exposto em `/api/v1/health`. Sem CI/CD ainda.
- Auditoria competitiva: 20/04/2026 contra RedeVeiculos.com / 21go.rastreamento.vip — 27% ✓, 23% ◐, 50% ✗.
