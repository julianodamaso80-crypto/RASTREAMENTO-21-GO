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
| JWT_ASSOCIATE_SECRET | (gerado via `openssl rand -base64 48`) — **diferente** do JWT_SECRET | EasyPanel env vars + 1Password |
| JWT_INTERNAL_EXPIRATION | não é segredo — valor `12h` | EasyPanel env vars |
| JWT_REQUIRE_TYPE | não é segredo — `false` no primeiro deploy, `true` depois | EasyPanel env vars |
| EasyPanel Admin | `marketing21goprotpatri@gmail.com` | 1Password → Infra |
| Cloudflare | `marketing21goprotpatri@gmail.com` | 1Password → Infra |
| Hostinger | — | `.mcp.json` (token API) + 1Password |
| SSH key | `~/.ssh/claude_21go` | Máquina local do desenvolvedor |
| GitHub | `julianodamaso80-crypto` | — |
| Google Maps Platform (Map Tiles API) | projeto GCP `21go-maps` | Google Cloud Console + 1Password |

**Nunca documente:** senhas, tokens, connection strings completas, chaves privadas, JWT secrets.

### Dois segredos JWT — o backend recusa subir sem eles

O mesmo binário atende três públicos: painel do time interno (`type: 'user'`), app do cliente final (`type: 'associate'`) e PWA do técnico (`type: 'technician'`). O que impede um token de cliente de valer no painel **não é um `if`** — é o segredo de assinatura ser outro.

| Variável | Obrigatória em produção | Regra |
|---|---|---|
| `JWT_SECRET` | sim | Mín. **32 caracteres**. Assina painel e PWA do técnico. |
| `JWT_ASSOCIATE_SECRET` | sim | Mín. **32 caracteres** e **diferente** de `JWT_SECRET`. Assina só o app do cliente. |
| `JWT_INTERNAL_EXPIRATION` | não (default `12h`) | Sessão do time interno, mais curta que a do cliente. |
| `JWT_REQUIRE_TYPE` | não (default `false`) | `true` passa a exigir o campo `type` no token. |

`assertJwtGuardRails` ([backend/src/config/jwt-guard-rails.ts](../backend/src/config/jwt-guard-rails.ts)) roda **antes** do `NestFactory.create` e **lança** se qualquer regra acima for violada em produção. Isso é proposital: subir com os dois segredos iguais transformaria o isolamento em decoração e ninguém perceberia. O preço é que subir sem `JWT_ASSOCIATE_SECRET` derruba `api.trackgo.site` em crash-loop — e junto vão o painel, o app, o PWA do técnico e a API que atende os rastreadores. **Setar as duas variáveis no EasyPanel ANTES do deploy, não depois.**

#### Item de ação datado — virar `JWT_REQUIRE_TYPE` para `true`

Tokens emitidos antes desta versão não têm o campo `type` e valem por até 24h. Enquanto existirem, exigir o campo deslogaria todo mundo que está trabalhando — por isso a flag nasce `false`, e o backend trata token sem `type` como token de painel.

- **Deploy da separação de segredos:** 2026-08-10
- **Virar `JWT_REQUIRE_TYPE=true`:** **2026-08-11**, 24h depois — nesse ponto nenhum token legado sobrevive.

```bash
# No EasyPanel: backend-rastreamento → env vars → JWT_REQUIRE_TYPE=true → redeploy
# Conferir depois: login no painel, no app e no /tecnico devem continuar funcionando.
```

Se este item não for executado, a segunda camada de defesa (exigir `type`) **nunca liga** e o sistema fica dependendo só da separação de segredos. Não é "recomendação" — é tarefa com data.

#### Efeito no suporte: a rotação desloga o app uma vez

Trocar o segredo do associado invalida todos os tokens do app já emitidos. No primeiro acesso depois do deploy, **todo cliente cai na tela de login uma vez** — entram de novo com a mesma senha, nada é perdido e nenhum cadastro precisa ser refeito. Avisar o suporte antes do deploy, senão vira enxurrada de chamado de "app deslogou sozinho".

### Satélite do Google (Map Tiles API)

O satélite de alta resolução do dashboard usa a **Map Tiles API 2D** do Google, consumida como source raster pelo MapLibre. Sem a variável abaixo o backend responde `provider: "esri"` e o front cai no Esri automaticamente — o mapa nunca quebra.

| Variável | Serviço | Obrigatória | Descrição |
|---|---|---|---|
| `GOOGLE_MAPS_API_KEY` | backend-rastreamento | não | Chave do GCP com **Map Tiles API** habilitada. Sem ela → fallback Esri. |
| `GOOGLE_MAPS_HIGH_DPI` | backend-rastreamento | não | `false` desliga tiles 2x. Default ligado (nitidez em tela retina). |
| `GOOGLE_MAPS_MIN_ZOOM` | backend-rastreamento | não | Default `0` = Google em todos os zooms (é o que está em prod). `20` volta a usar Esri abaixo desse zoom, cobrando só onde o Esri não tem imagery. |
| `GOOGLE_MAPS_REFERRER` | backend-rastreamento | não | Default `https://trackgo.site/`. Header `Referer` que o backend envia ao Google. **Precisa bater com uma das entradas de "Websites" na restrição da chave**, senão `createSession` toma 403. |

**Economia por faixa de zoom.** O satélite é montado em duas camadas: Esri por baixo em todos os zooms e Google por cima só de `GOOGLE_MAPS_MIN_ZOOM` pra cima — que é exatamente onde o Esri deixa de ter imagery no Brasil. O MapLibre não baixa tiles de layer fora da faixa, então navegar de longe não gera custo nenhum.

Medições que embasam o default (sessão de operador em tela 1600×900, Campo Grande/RJ):

| Medição | Valor |
|---|---|
| Tiles de uma sessão com 3 veículos consultados | 508 |
| Fatia em z≥20 (única faixa em que o Esri não tem imagem) | 31% |
| Chamadas ao Google em z≤19 (verificado no navegador) | **0** |

Se um tile do Google falhar, o Esri continua embaixo — aparece a imagem antiga, nunca um buraco.

Passos no Google Cloud Console:

1. Criar projeto, ativar **billing** e habilitar a **Map Tiles API**.
2. Criar chave de API e **restringir por API** (só Map Tiles API) e **por referrer HTTP**: `https://trackgo.site/*` e `https://www.trackgo.site/*`.
3. Definir **alerta de orçamento** e **cota diária** de requisições — o SKU cobra por tile após 100k/mês grátis.
4. Setar `GOOGLE_MAPS_API_KEY` no serviço `backend-rastreamento` e redeployar (não precisa rebuildar o frontend — a chave chega via API, não via build arg).

Regras da política do Google respeitadas pelo código: logo Google visível no mapa ([google-attribution.tsx](../frontend/dashboard/src/components/map/google-attribution.tsx)), atribuição do viewport buscada dinamicamente e **nenhum cache de tiles**.

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

### ⚠️ Traccar: `traccar.xml` só vale depois de reiniciar — e o reinício precisa ser `stop-first`

O `traccar.xml` é bind-mount de `/etc/easypanel/projects/rastreamento-21-go/traccar-rastreamento/traccar.xml`. Editar o arquivo **não** muda nada até o container reiniciar (o Traccar lê a config só no boot).

O service publica as portas 5001–5055 em **modo host**. Com `UpdateConfig.Order = start-first` (padrão do EasyPanel), o Swarm tenta subir o container novo antes de parar o velho, as portas estão ocupadas e a atualização fica em `Pending — "host-mode port already in use"` **para sempre**. Foi assim que em 2026-08-18 se descobriu que o Traccar rodava uma task de 6 semanas atrás e os filtros de precisão de 10/08 nunca tinham entrado em vigor.

```bash
# uma vez (persistente no spec do service):
docker service update --update-order stop-first rastreamento-21-go_traccar-rastreamento
# reiniciar depois de editar o traccar.xml:
docker service update --force rastreamento-21-go_traccar-rastreamento
# se ficar Pending mesmo assim (reserva de porta presa): scale 0 → 1
docker service scale rastreamento-21-go_traccar-rastreamento=0 && sleep 5 && \
docker service scale rastreamento-21-go_traccar-rastreamento=1
# conferir que a config nova está no container:
docker exec $(docker ps -q -f name=traccar-rastreamento) grep -c skipLimit /opt/traccar/conf/traccar.xml
```

Janela sem GPS durante o reinício: ~30 s. Rastreadores GT06 reconectam sozinhos (4.000+ conexões em ~1 min).

### ⚠️ SGA Hinova em produção

- `HINOVA_MOCK=false` e as env `HINOVA_SGA_USUARIO/SENHA/TOKEN/BASE_URL` no backend são **obrigatórias**. Com `HINOVA_MOCK=true` o vínculo do estoque recusa qualquer placa real ("Placa não encontrada no SGA (mock)") e o sync de pendências carrega 34 registros falsos. Aplicadas em 2026-08-18 via `docker service update --env-add`; **precisam ser replicadas na UI do EasyPanel** senão um Deploy pela UI reverte.
- O usuário de integração do SGA tem **restrição de horário** cadastrada no próprio SGA: fora da janela a autenticação responde `"Usuário com restrição de horário"` e todo vínculo/sync falha. Ajuste é no cadastro do usuário dentro do SGA, não aqui.
- O lookup ao vivo (`/buscar/situacao-financeira-veiculo`) é financeiro: veículo novo sem boleto retorna 406. O vínculo cai então no espelho de pendências (`installation_pendings`), que aceita placa ou chassi — por isso o sync 9h/17h precisa estar rodando com credencial real.

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
