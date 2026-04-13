# Decisões Arquiteturais (ADR)

Registro cronológico das decisões que moldaram o Rastreamento 21 GO. Formato: contexto → decisão → razão → consequências. Atualizar quando uma decisão for substituída (marcar como "superseded by ADR-XXX"), nunca deletar.

---

## ADR-001: EasyPanel + DigitalOcean em vez de Railway/Vercel

**Data:** 2026-04-10
**Status:** Ativa

**Contexto.** Precisávamos de uma plataforma para hospedar 5 serviços heterogêneos (Next.js, NestJS, Traccar Java, PostgreSQL, Redis) com domínios customizados, WebSocket e portas TCP raw expostas (5001–5055) para rastreadores GPS.

**Decisão.** Usar um droplet DigitalOcean com EasyPanel (UI sobre Docker Swarm + Traefik).

**Razão.**
- Custo previsível (droplet fixo ~$12/mês) contra o modelo por-uso de Railway/Vercel que escala mal com tráfego de 1 posição por minuto × N rastreadores.
- Traefik do EasyPanel cuida de TLS automaticamente.
- Exposição de portas TCP raw para rastreadores é trivial em Swarm com `PublishMode: host` — impossível no Vercel.
- Controle total sobre Java/JVM do Traccar.

**Consequências.** Time assume responsabilidade por uptime, segurança, backups e atualizações de SO. Sem CI/CD automático no MVP — deploys são manuais via SSH + `docker build` + `docker service update`.

---

## ADR-002: Nomenclatura de serviços com sufixo `-rastreamento`

**Data:** 2026-04-10
**Status:** Ativa

**Decisão.** Todos os serviços no projeto EasyPanel usam o sufixo `-rastreamento`: `postgres-rastreamento`, `redis-rastreamento`, `traccar-rastreamento`, `backend-rastreamento`, `frontend-rastreamento`.

**Razão.** O droplet também hospeda outros projetos (astrologia, etc.). O nome do service aparece em `docker service ls`, logs e no hostname DNS interno do Swarm. O sufixo elimina qualquer ambiguidade.

**Consequências.** Hostnames internos ficam longos: `rastreamento-21-go-postgres-rastreamento:5432`. Aceitável — só aparece em env vars do backend.

---

## ADR-003: Arquitetura de 2 IPs (não 3)

**Data:** 2026-04-11
**Status:** Ativa — substitui a proposta inicial de 3 IPs (primário, secundário, manutenção)

**Contexto.** A arquitetura original previa 3 IPs: primário, secundário e um terceiro para "acesso técnico/manutenção". A limitação da DigitalOcean é de **1 Reserved IP gratuito por droplet** — o segundo IP custaria extra sem justificativa técnica.

**Decisão.** Ficar com 2 IPs:
- **gps1.trackgo.site** → `167.71.31.77` (IP primário do droplet)
- **gps2.trackgo.site** → `168.144.13.3` (Reserved IP — backup/failover)

Qualquer acesso de "manutenção" reusa `gps2`.

**Razão.** Modelos GT06/J16 suportam nativamente apenas `SERVER,1` (primário) e `SERVER,2` (secundário) via SMS. Um terceiro IP não traria benefício operacional: rastreadores velhos não sabem o que fazer com ele.

**Consequências.** Env vars `SERVER_MAINTENANCE_IP` e `SERVER_HOSTNAME_MAINTENANCE` foram removidas do backend, frontend, tipos TypeScript e `.env.example`. A UI de `/configuracoes` agora mostra 2 cards (não 3). Ver commit `5c0256c`.

---

## ADR-004: DNS dos servidores GPS sem proxy Cloudflare

**Data:** 2026-04-11
**Status:** Ativa

**Decisão.** Os registros DNS `gps1.trackgo.site` e `gps2.trackgo.site` no Cloudflare ficam com **proxy OFF (nuvem cinza)**. Todos os outros subdomínios (`trackgo.site`, `api`, `traccar`, `painel`) ficam com proxy ON.

**Razão.** O proxy Cloudflare só repassa HTTP/HTTPS. Rastreadores GT06/Suntech/H02/Teltonika se comunicam via **TCP raw** nas portas 5001–5055. Com proxy ligado, a Cloudflare bloqueia o TCP e o rastreador nunca conecta.

**Consequências.**
- IPs reais do servidor ficam expostos publicamente nesses dois subdomínios. Aceitável porque Traccar já escuta nessas portas de qualquer forma.
- Perdemos os benefícios Cloudflare (DDoS, WAF) nesses hostnames. Mitigação: firewall a nível de SO filtra portas não-GPS.

---

## ADR-005: Templates SMS usam DNS hostname, não IP raw

**Data:** 2026-04-11 (commit `1e318b9`)
**Status:** Ativa

**Contexto.** Os templates SMS para rastreadores GT06/Suntech/etc. antes codificavam o IP do servidor diretamente: `SERVER,1,167.71.31.77,5023,0#`. Trocar de servidor significaria enviar SMS de reconfiguração para **todos os rastreadores no campo** — custo proibitivo.

**Decisão.** Templates usam o hostname DNS: `SERVER,1,gps1.trackgo.site,5023,0#`. Fallback para IP raw só quando o rastreador não suporta DNS.

**Razão.** Indireção via DNS permite trocar o IP do servidor sem tocar nos rastreadores em campo — basta atualizar o A record no Cloudflare.

**Consequências.**
- Backend tem 4 funções `getServerAddress / getSecondaryAddress / getServerHostname / getBackupHostname` com lógica de preferência hostname > IP.
- Rastreadores muito antigos (alguns TK103 clones) que não resolvem DNS precisam do fallback para IP — ainda funciona.
- Env vars `SERVER_HOSTNAME` e `SERVER_HOSTNAME_BACKUP` são obrigatórias em produção. Um deploy sem elas degrada para IP raw silenciosamente.

---

## ADR-006: Session LMDB para EasyPanel API (fallback)

**Data:** 2026-04-12
**Status:** Ativa

**Contexto.** Automações precisam chamar a API tRPC do EasyPanel (criar services, editar env vars). O tier free não oferece API tokens oficiais — o painel depende de uma sessão de cookie armazenada no LMDB interno em `/etc/easypanel/data/data.mdb`.

**Decisão.** Extrair o `sessionId` do LMDB e usá-lo como Bearer token nas chamadas à API do EasyPanel.

**Razão.** Único caminho de automação disponível sem pagar upgrade de plano.

**Consequências.**
- Sessão expira periodicamente — quando expira, precisa login manual no painel e re-extração.
- `mdb_dump` do Ubuntu (`lmdb-utils`) pode falhar com `MDB_VERSION_MISMATCH` dependendo da versão que o EasyPanel usou para gravar. Quando falhar, fallback é `docker service update` direto no Swarm (ver DEPLOY.md §5).

---

## ADR-007: Mobile — React Native + Expo com monorepo

**Data:** 2026-04-12
**Status:** Planejada (não iniciada — referência em `docs/mobile-app-*.md`)

**Decisão.** Dois apps mobile (`21 GO Admin` para staff, `21 GO Rastreamento` para cliente final) construídos com React Native + Expo SDK 53, organizados no mesmo repo via Turborepo + packages compartilhados (`shared-types`, `api-client`, `validation`, `utils`).

**Razão.** 60–70% de código compartilhável com o dashboard Next.js (tipos, API client, validação Zod). Mesmo TypeScript em todo o stack. MapLibre React Native alinhado com MapLibre GL JS do dashboard web.

**Consequências.** Migração para Turborepo exigida antes do primeiro commit mobile. Timeline estimada: 16 semanas (2 setup + 8 cliente + 6 admin). Detalhes operacionais em `docs/mobile-app-roadmap.md`.

---

## ADR-008: Rotação de JWT_SECRET comprometido

**Data:** 2026-04-13 (commit `835a3b1`)
**Status:** Ativa

**Contexto.** Auditoria de produção revelou que `JWT_SECRET` estava com o valor literal `R21go-jwt-secret-prod-2026-change-me` — um placeholder que ficou em produção por engano. Qualquer pessoa com acesso visual à env var (logs, screenshots, issues) poderia forjar JWTs e se autenticar como qualquer usuário, incluindo SUPER_ADMIN.

**Decisão.** Rotacionar imediatamente para um segredo gerado via `openssl rand -base64 48`. Novo segredo armazenado apenas no 1Password; não é commitado em lugar nenhum.

**Razão.** Vulnerabilidade de segurança crítica. Risco > impacto de re-login forçado dos usuários ativos (hoje apenas o admin).

**Consequências.**
- Tokens emitidos antes de 2026-04-13 13:12 UTC estão inválidos — usuários ativos precisam fazer login novamente.
- Atualização feita via `docker service update --env-add` (não via UI do EasyPanel) por causa da incompatibilidade `MDB_VERSION_MISMATCH` (ver ADR-006). **Followup manual:** replicar o valor na UI do EasyPanel antes do próximo deploy via painel, senão o valor antigo reverte.
- Todo doc/checklist que mencionava "trocar JWT_SECRET em produção" como TODO pode ser removido (já feito).
