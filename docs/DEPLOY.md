# Deploy e Operação — Rastreamento 21 GO

Documento operacional. Tudo que é referente a produção, incidentes, credenciais e runbook mora aqui. Para referência técnica de desenvolvimento, veja [skills/rastreamento-21-go/SKILL.md](../skills/rastreamento-21-go/SKILL.md).

---

## 1. Infraestrutura

| Item | Valor |
|---|---|
| Provider | DigitalOcean |
| Droplet | `21-GO-SERVIDOR` |
| IP Primário | `167.71.31.77` → `gps1.trackgo.site` |
| Reserved IP | `168.144.13.3` → `gps2.trackgo.site` |
| Plataforma | [EasyPanel](https://painel.trackgo.site) |
| Orquestração | Docker Swarm |
| Reverse Proxy | Traefik (gerenciado pelo EasyPanel) |
| SSH | `ssh -i ~/.ssh/claude_21go root@167.71.31.77` |
| Checkout no servidor | `/root/RASTREAMENTO-21-GO` |

---

## 2. Serviços em Produção

Projeto EasyPanel: **`rastreamento-21-go`**.

| Serviço | Imagem | Porta interna | Domínio público | Propósito |
|---|---|---|---|---|
| `frontend-rastreamento` | `r21go-frontend:latest` | 3000 | `trackgo.site`, `www.trackgo.site` | Next.js dashboard |
| `backend-rastreamento` | `r21go-backend:latest` | 3001 | `api.trackgo.site` | NestJS API + WebSocket |
| `traccar-rastreamento` | `traccar/traccar:6.5` | 8082 | `traccar.trackgo.site` | Motor GPS |
| `postgres-rastreamento` | `postgres:17` | 5432 | — (interno) | Banco principal |
| `redis-rastreamento` | `redis:7` | 6379 | — (interno) | Cache/fila |

**Portas TCP publicadas pelo Traccar (host mode) para rastreadores:**
`5001` (GPS103/TK103), `5011` (Suntech), `5013` (H02/Sinotrack), `5023` (GT06/J16/Concox), `5027` (Teltonika), `5055` (OsmAnd), `8082` (HTTP/API).

---

## 3. Domínios e DNS

DNS gerenciado pela Cloudflare (conta `marketing21goprotpatri@gmail.com`). Domínio raiz `trackgo.site` registrado na Hostinger.

| Domínio | Proxy Cloudflare | Destino | Propósito |
|---|---|---|---|
| `trackgo.site` | ON (laranja) | 167.71.31.77 | Dashboard |
| `www.trackgo.site` | ON | 167.71.31.77 | Dashboard (www) |
| `api.trackgo.site` | ON | 167.71.31.77 | Backend REST/WS |
| `traccar.trackgo.site` | ON | 167.71.31.77 | Traccar UI |
| `painel.trackgo.site` | ON | 167.71.31.77 | EasyPanel UI |
| `gps1.trackgo.site` | **OFF (cinza)** | 167.71.31.77 | Porta TCP raw para rastreadores |
| `gps2.trackgo.site` | **OFF (cinza)** | 168.144.13.3 | Servidor backup para rastreadores |

### ⚠️ REGRA CRÍTICA: `gps1` e `gps2` com proxy OFF

O proxy Cloudflare só repassa HTTP/HTTPS. Rastreadores GT06/J16/Suntech/etc. se comunicam via **TCP raw** (portas 5001–5055). Se o proxy ficar ligado, o tráfego é bloqueado na Cloudflare e o rastreador nunca envia posição. **Sempre manter cinza.**

---

## 4. Credenciais (referência — valores no 1Password)

Nunca commitar valores reais em arquivos, issues ou comentários. Use o 1Password (cofre `Rastreamento 21GO`) como fonte de verdade.

| Sistema | Username | Onde buscar |
|---|---|---|
| Backend Admin (SUPER_ADMIN) | `admin@rastreamento21go.com.br` | 1Password → Rastreamento 21GO |
| Traccar Admin | `admin@rastreamento21go.com.br` | 1Password → Rastreamento 21GO |
| PostgreSQL | `postgres` | EasyPanel env vars |
| JWT_SECRET | (gerado via `openssl rand -base64 48`) | EasyPanel env vars + 1Password |
| EasyPanel Admin | `marketing21goprotpatri@gmail.com` | 1Password → Infra |
| Cloudflare | `marketing21goprotpatri@gmail.com` | 1Password → Infra |
| Hostinger | — | `.mcp.json` (token API) + 1Password |
| SSH key | `~/.ssh/claude_21go` | Máquina local do desenvolvedor |
| GitHub | `julianodamaso80-crypto` | — |

**Nunca documente:** senhas, tokens, connection strings completas, chaves privadas, JWT secrets.

---

## 5. Como Fazer Deploy

O deploy atual é manual via SSH + rebuild de imagem Docker no próprio servidor. Não há CI/CD automático ainda.

### Fluxo padrão (backend ou frontend)

```bash
# 1. Pushar seu código para main (GitHub)
git push origin main

# 2. SSH no servidor
ssh -i ~/.ssh/claude_21go root@167.71.31.77

# 3. Pull do código
cd /root/RASTREAMENTO-21-GO
git pull origin main

# 4. Rebuild da imagem (escolha uma)
docker build -t r21go-backend:latest -f backend/Dockerfile backend/
# ou
docker build -t r21go-frontend:latest -f frontend/dashboard/Dockerfile frontend/dashboard/

# 5. Force redeploy do service Swarm
docker service update --force --image r21go-backend:latest \
  rastreamento-21-go_backend-rastreamento
```

### Atualizar uma variável de ambiente

```bash
docker service update \
  --env-rm VAR_NAME \
  --env-add VAR_NAME=novo-valor \
  rastreamento-21-go_backend-rastreamento
```

### ⚠️ Drift com o EasyPanel UI

`docker service update` altera o estado runtime do Swarm, mas o EasyPanel mantém a fonte de verdade em seu próprio LMDB. Se alguém abrir o painel e clicar em "Deploy" no service, o EasyPanel pode **reverter** env vars modificadas via linha de comando.

**Regra:** quando você alterar env vars via `docker service update`, replique a mesma mudança na UI do EasyPanel (`https://painel.trackgo.site` → projeto → service → Environment) antes do próximo deploy pela UI.

---

## 6. EasyPanel API (método LMDB)

O EasyPanel free tier não oferece API tokens oficiais. Para automações via API é preciso extrair o `sessionId` do LMDB em `/etc/easypanel/data/data.mdb` e usá-lo como Bearer token nas chamadas tRPC.

**Limitação conhecida:** o LMDB gravado pelo EasyPanel pode usar versão incompatível com o `mdb_dump` do pacote `lmdb-utils` do Ubuntu (erro `MDB_VERSION_MISMATCH`). Quando acontecer, o fallback é usar `docker service update` direto (ver seção 5) e depois replicar na UI manualmente.

---

## 7. Runbook de Incidentes

### Site fora do ar

```bash
# 1. Ver estado dos services
ssh -i ~/.ssh/claude_21go root@167.71.31.77 "docker service ls --filter name=rastreamento"

# 2. Se algum estiver 0/1, ver por que falhou
docker service ps rastreamento-21-go_backend-rastreamento --no-trunc

# 3. Ver logs do service
docker service logs --tail 200 rastreamento-21-go_backend-rastreamento
```

### Ver logs de um serviço específico

```bash
docker service logs --tail 100 -f rastreamento-21-go_backend-rastreamento
docker service logs --tail 100 -f rastreamento-21-go_frontend-rastreamento
docker service logs --tail 100 -f rastreamento-21-go_traccar-rastreamento
```

Alternativa: logs do Traccar em arquivo no host em `/etc/easypanel/projects/rastreamento-21-go/traccar-rastreamento/data/tracker-server.log`.

### Reverter um deploy

```bash
# Listar imagens anteriores
docker image ls r21go-backend --format '{{.ID}} {{.CreatedAt}}'

# Rebuildar a partir de um commit anterior
cd /root/RASTREAMENTO-21-GO
git checkout <hash-anterior>
docker build -t r21go-backend:latest -f backend/Dockerfile backend/
docker service update --force --image r21go-backend:latest \
  rastreamento-21-go_backend-rastreamento
git checkout main
```

### Escalar serviços

```bash
docker service scale rastreamento-21-go_backend-rastreamento=2
```

⚠️ Backend **não é stateless hoje** (mantém cache device→tenant no TraccarGateway). Escalar > 1 instância exige primeiro mover esse cache para Redis.

### Rastreadores sem enviar posição

1. Verificar DNS: `dig gps1.trackgo.site` deve retornar `167.71.31.77` (proxy OFF).
2. Verificar TCP: `nc -zv 167.71.31.77 5023` (ou a porta do modelo).
3. Ver logs Traccar: `docker service logs rastreamento-21-go_traccar-rastreamento | grep <imei>`.
4. Checar `/api/v1/server/info` retornando os hostnames corretos.

### Rotação de segredo (exemplo JWT)

```bash
NEW=$(ssh -i ~/.ssh/claude_21go root@167.71.31.77 "openssl rand -base64 48")
ssh -i ~/.ssh/claude_21go root@167.71.31.77 \
  "docker service update --env-rm JWT_SECRET --env-add JWT_SECRET='$NEW' \
   rastreamento-21-go_backend-rastreamento"
# Salvar $NEW no 1Password, atualizar no EasyPanel UI
```

---

## 8. Checklist de Saúde (rodar periodicamente)

- [ ] `docker service ls` — todos os services `1/1`
- [ ] `curl -I https://trackgo.site` — 200
- [ ] `curl -I https://api.trackgo.site/api/v1/auth/login` — 405 (GET não permitido, prova que o handler existe)
- [ ] `dig gps1.trackgo.site` e `dig gps2.trackgo.site` — IPs corretos, proxy OFF
- [ ] `nc -zv 167.71.31.77 5023` e `nc -zv 168.144.13.3 5023` — ambos OK
- [ ] Espaço em disco do droplet (`df -h`)
- [ ] Backups do PostgreSQL em dia (quando automatizados)
