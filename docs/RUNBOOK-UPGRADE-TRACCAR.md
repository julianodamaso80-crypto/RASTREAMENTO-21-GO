# Runbook — Upgrade do Traccar 6.5 → 6.14.5 em produção

Documento operacional para quem for executar o upgrade do motor GPS em produção
(`traccar-rastreamento`, serviço EasyPanel do projeto `rastreamento-21-go`).
Segue o mesmo formato de [DEPLOY.md](DEPLOY.md) — leia aquele documento primeiro
se não conhece a infraestrutura.

As evidências que embasam este runbook estão medidas, não presumidas, em
[.superpowers/sdd/etapa2-traccar-evidencias.md](../.superpowers/sdd/etapa2-traccar-evidencias.md):
16/16 endpoints REST usados pelo backend compatíveis, WebSocket compatível, 25
chaves de config conferidas uma a uma contra `Keys.java` da tag `v6.14.5`.
Esse `16/16` é a contagem da fase de evidência (endpoints comparados um a um
contra o código-fonte). É um número diferente do `18/18 OK` que aparece nas
seções 3 e 6 — aquele é a saída do script `scripts/traccar-contrato.py`, que
soma passos de teste (inclui `GET /devices?uniqueId=` e `/reports/summary`,
que não entravam na contagem de endpoints, mais as operações de limpeza dos
recursos que o próprio script cria). Os dois números estão certos; contam
coisas diferentes.

**Este runbook não foi executado.** Ninguém com acesso a este repositório tinha
SSH pra produção no momento em que foi escrito — só o preparo (compose de dev,
script de contrato, esta documentação) foi feito. Quem for rodar em produção é
quem primeiro executa os passos abaixo de verdade.

---

## 0. Antes de começar

- Confirmar que você tem acesso SSH: `ssh -i ~/.ssh/claude_21go root@167.71.31.77`.
- Reservar uma janela de baixo tráfego, mesmo sabendo que o reinício é rápido
  (~30 s de janela sem GPS, rastreadores GT06 reconectam sozinhos — ver seção 5
  de [DEPLOY.md](DEPLOY.md)).
- Ter o `scripts/traccar-contrato.py` deste repositório disponível (Python 3,
  biblioteca padrão, sem dependências).

---

## 1. Baseline — confirmar que está tudo saudável ANTES de mexer

Regra do projeto: nunca mexer em produção sem saber o estado de antes. Rodar
e **anotar** o resultado de cada comando:

```bash
curl -s -o /dev/null -w "dashboard: %{http_code}\n" https://trackgo.site
curl -s -o /dev/null -w "api: %{http_code}\n" https://api.trackgo.site/api/v1/auth/login
curl -s -o /dev/null -w "traccar: %{http_code}\n" https://traccar.trackgo.site/api/server

# versão atual — guardar esse número para comparar depois do upgrade
curl -s https://traccar.trackgo.site/api/server | grep -o '"version":"[^"]*"'
```

Esperado hoje: `dashboard` e `traccar` em `200`; `api` em `405` — GET não é
permitido em `/auth/login` (é rota de POST), e o 405 é o sinal saudável: prova
que o handler existe. Mesmo critério do checklist de saúde do projeto (ver
[DEPLOY.md §8](DEPLOY.md#8-checklist-de-saúde-rodar-periodicamente)). E
`"version":"6.5"` (ou o que estiver efetivamente publicado — não presumir,
ler o retorno).

Se `dashboard` ou `traccar` não forem 200, ou se `api` não for 405, **pare
aqui**. Resolver o que já está quebrado é prioridade sobre o upgrade (ver
Regra 0 do projeto).

---

## 2. Fatos da migração (o que muda no schema)

- Todos os changesets de schema entre 6.5 e 6.14 são **aditivos** — colunas e
  tabelas novas, lidos um a um a partir do código-fonte da tag `v6.14.5`. Nada
  remove ou renomeia coluna existente.
- **Único risco real: TimescaleDB.** Os changesets 6.8 e 6.11 convertem
  `tc_positions`, `tc_events` e `tc_actions` em hypertables **se a extensão
  `timescaledb` estiver disponível** no Postgres. Nossa produção roda
  `postgres:17` puro (sem a extensão) — o precondition do Liquibase detecta a
  ausência, marca `MARK_RAN` e não faz nada. Isso só vira risco se alguém, no
  futuro, instalar TimescaleDB nesse mesmo Postgres.
- **Regra dura: nunca trocar a imagem do Postgres no mesmo deploy do upgrade
  do Traccar.** Se um dia quiser adicionar TimescaleDB, faça isso *depois*,
  isolado, com o Traccar já estável na 6.14.5 — nunca as duas mudanças juntas,
  senão não dá pra saber qual delas causou um problema.
- Estes fatos vêm de ler o código-fonte da tag `v6.14.5`, não de já ter
  rodado a migração contra o nosso banco real — é exatamente essa lacuna que
  a seção 3 fecha.

---

## 3. Ensaio — rodar a migração real contra uma cópia de produção

**Este é o único passo irreversível de todo o procedimento**: depois que o
Liquibase aplica os changesets 6.5→6.14.5 no banco de produção, não existe
`liquibase rollback` de fábrica configurado neste projeto — só um restore de
backup desfaz. Testar isso primeiro contra um banco **vazio** (como uma
versão anterior deste runbook fazia) só prova que a 6.14.5 nova sobe e
responde à API REST — não prova que o Liquibase aplica os changesets **nos
nossos dados reais**, com o volume e as inconsistências que só existem depois
de meses em produção. Um teste todo verde contra banco vazio prova bem menos
do que parece.

O ensaio abaixo usa um dump real de produção, restaurado num Postgres
descartável, e observa o Liquibase migrar de verdade — sem tocar em produção.

### 3.1 Tirar o dump de ensaio

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77

# 1. Descobrir o banco exato que o Traccar de produção usa —
#    não presumir o nome, ler do próprio traccar.xml publicado:
cat /etc/easypanel/projects/rastreamento-21-go/traccar-rastreamento/traccar.xml \
  | grep 'database.url'
# ex.: jdbc:postgresql://postgres-rastreamento:5432/<nome-do-banco>

# 2. Dump desse banco específico, de dentro do container do Postgres:
PGCID=$(docker ps -q -f name=postgres-rastreamento)
docker exec "$PGCID" pg_dump -U postgres -d <nome-do-banco> -F c \
  -f "/tmp/traccar-ensaio.dump"

# 3. Copiar o dump para fora do container e do droplet:
docker cp "$PGCID:/tmp/traccar-ensaio.dump" "/root/traccar-ensaio.dump"
# 4. Copiar também o traccar.xml de produção — a seção 3.3 usa ele como base,
#    só trocando o host do banco:
cp /etc/easypanel/projects/rastreamento-21-go/traccar-rastreamento/traccar.xml \
  /root/traccar-producao.xml
exit  # sai do SSH
scp -i ~/.ssh/claude_21go root@167.71.31.77:/root/traccar-ensaio.dump .
scp -i ~/.ssh/claude_21go root@167.71.31.77:/root/traccar-producao.xml .
```

**Este dump é só para o ensaio — não serve pra rollback.** Ele pode ficar
velho enquanto o ensaio roda (seção 3.2 a 3.4 pode levar um tempo). O dump
que protege o rollback de verdade é tirado de novo, com timestamp fresco,
na seção 4 — imediatamente antes do upgrade real.

### 3.2 Restaurar num Postgres descartável

Numa máquina qualquer com Docker (o próprio droplet ou sua máquina — só não
o Postgres de produção):

```bash
# Extrair usuário e senha REAIS do traccar.xml de produção — se o Postgres
# de ensaio não aceitar as mesmas credenciais que o traccar.xml carrega
# (seção 3.3 só troca o host), o Traccar de teste nunca conecta e a
# migração Liquibase, que é o motivo de existir esta seção, nunca roda.
DB_USER=$(grep -oP "(?<=<entry key='database.user'>).*(?=</entry>)" traccar-producao.xml)
DB_PASSWORD=$(grep -oP "(?<=<entry key='database.password'>).*(?=</entry>)" traccar-producao.xml)

docker network create traccar-ensaio-net 2>/dev/null || true

docker run -d --name pg-ensaio --network traccar-ensaio-net \
  -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  -e POSTGRES_DB=<nome-do-banco> \
  postgres:17

# esperar aceitar conexão antes do restore
until docker exec pg-ensaio pg_isready -U "$DB_USER"; do sleep 2; done

docker cp traccar-ensaio.dump pg-ensaio:/tmp/
docker exec pg-ensaio pg_restore -U "$DB_USER" -d <nome-do-banco> \
  --clean --if-exists /tmp/traccar-ensaio.dump
```

### 3.3 Apontar um Traccar 6.14.5 pra essa cópia e assistir a migração

```bash
# copiar o traccar.xml de produção e trocar só o host do banco pro Postgres
# de ensaio — tudo o mais (usuário, senha, demais chaves) fica igual ao real
sed 's#jdbc:postgresql://[^/]*/#jdbc:postgresql://pg-ensaio:5432/#' \
  traccar-producao.xml > traccar-ensaio.xml

docker run -d --name traccar-upgrade-teste --network traccar-ensaio-net \
  -p 18092:8082 \
  -v "$(pwd)/traccar-ensaio.xml:/opt/traccar/conf/traccar.xml:ro" \
  traccar/traccar:6.14.5

# É AQUI que a migração 6.5→6.14.5 acontece de verdade — acompanhar até o fim
docker logs -f traccar-upgrade-teste
```

O que esperar no log, em ordem: uma sequência de linhas `Running Changeset:
changelog-X.Y::...::author` (um por changeset, incluindo `6.8.0-timescale` e
`6.11.0-timescale` — ver seção 2, são os que o precondition pula em silêncio
sem a extensão) terminando em `Liquibase: Update has been successful. Rows
affected: N`, seguido do servidor web subindo normalmente. **O que uma falha
parece:** uma stack trace do Liquibase (`liquibase.exception.*Exception`) no
meio da sequência de changesets, o container saindo (`docker ps` não mostra
`Up`) ou nunca respondendo em `:18092`. Se isso acontecer, **não prosseguir
para produção** — investigar a causa contra este mesmo dump antes de tocar
no banco real.

### 3.4 Contrato REST contra a cópia restaurada

A cópia já tem os usuários reais de produção — não criar usuário novo, usar
as credenciais reais (mesmas do 1Password usadas na seção 6). Usar
`--base-url`, não `TRACCAR_BASE_URL`: se `TRACCAR_API_URL` já estiver
exportada no shell apontando pra produção (é o nome de variável que o
próprio backend usa), ela tem prioridade sobre `TRACCAR_BASE_URL` e o
ensaio local rodaria contra produção sem avisar. `--base-url` sempre
vence, então é a única forma segura de garantir que este comando roda
contra `localhost:18092`:

```bash
python scripts/traccar-contrato.py \
  --base-url http://localhost:18092/api \
  --email admin@rastreamento21go.com.br \
  --password '<no 1Password>'
```

Esperado: `18/18 OK`, saída `0` — agora contra dados reais, não um banco
vazio. Se alguma linha falhar, **não prosseguir** — investigar antes de
tocar em produção.

### 3.5 Descartar o ambiente de ensaio

Nada aqui tocou produção — é só derrubar. Isto inclui apagar TODA cópia do
dump e do `traccar.xml`, local e no droplet: o dump é uma cópia integral
dos dados de clientes, e `traccar-producao.xml`/`traccar-ensaio.xml`
carregam `database.user`/`database.password` reais de produção — nenhum
dos dois pode ficar pra trás em disco depois que o ensaio termina.

```bash
docker rm -f traccar-upgrade-teste pg-ensaio
docker network rm traccar-ensaio-net

# apagar as cópias que ficaram no droplet (seção 3.1, passos 3 e 4)
ssh -i ~/.ssh/claude_21go root@167.71.31.77 \
  'rm -f /root/traccar-ensaio.dump /root/traccar-producao.xml'

# apagar as cópias locais — inclui traccar-producao.xml, que a seção 3.1
# trouxe por scp e a limpeza anterior deste runbook esquecia
rm -f traccar-ensaio.dump traccar-ensaio.xml traccar-producao.xml
```

---

## 4. Backup real — dump imediatamente antes do upgrade

Este é o dump que protege o rollback (seção 7). Repetir exatamente os mesmos
passos da seção 3.1, com timestamp novo — **rodar agora, o mais perto
possível da seção 5**, não antes: qualquer posição ou evento gravado entre
este dump e o corte de produção fica protegido; qualquer coisa gravada
*durante* o ensaio da seção 3 (que pode ter levado minutos ou horas) **não
está** neste dump se ele for tirado antes do ensaio — por isso a ordem
importa.

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77

PGCID=$(docker ps -q -f name=postgres-rastreamento)
STAMP=$(date +%Y%m%d-%H%M)
docker exec "$PGCID" pg_dump -U postgres -d <nome-do-banco> -F c \
  -f "/tmp/traccar-pre-upgrade-$STAMP.dump"

docker cp "$PGCID:/tmp/traccar-pre-upgrade-$STAMP.dump" \
  "/root/traccar-pre-upgrade-$STAMP.dump"
exit  # sai do SSH
scp -i ~/.ssh/claude_21go \
  root@167.71.31.77:/root/traccar-pre-upgrade-$STAMP.dump .
```

Confirmar que o arquivo chegou e não está vazio (`ls -lh`) antes de
prosseguir. Guardar o `$STAMP` usado — é o nome do arquivo que a seção 7
(rollback) pede de volta.

---

## 5. Upgrade em produção

Com o baseline (seção 1), o ensaio da migração real (seção 3) todo verde e o
backup fresco (seção 4) feito:

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77

# a config do service já deve estar em stop-first (ver DEPLOY.md §5);
# se não estiver, setar antes:
docker service update --update-order stop-first \
  rastreamento-21-go_traccar-rastreamento

# trocar a imagem
docker service update --force \
  --image traccar/traccar:6.14.5 \
  rastreamento-21-go_traccar-rastreamento

# acompanhar o rollout
docker service ps rastreamento-21-go_traccar-rastreamento --no-trunc
```

Replicar a troca de imagem também na UI do EasyPanel
(`https://painel.trackgo.site` → projeto → `traccar-rastreamento`), senão um
próximo "Deploy" pela UI reverte para `6.5` (drift documentado em
[DEPLOY.md §5](DEPLOY.md#5-como-fazer-deploy)).

Se o service ficar `Pending` por porta host presa, mesmo procedimento de
sempre: `docker service scale ..._traccar-rastreamento=0` e depois `=1`
(ver [DEPLOY.md §5](DEPLOY.md#5-como-fazer-deploy)).

---

## 6. Verificação depois do deploy — não presumir sucesso

Container de pé **não** é sucesso. O que importa é rastreador real mandando
posição de novo. Verificar, nesta ordem:

```bash
# 1. Os três domínios continuam saudáveis — dashboard e traccar em 200,
#    api em 405 (GET não permitido em /auth/login, prova que o handler existe)
curl -s -o /dev/null -w "dashboard: %{http_code}\n" https://trackgo.site
curl -s -o /dev/null -w "api: %{http_code}\n" https://api.trackgo.site/api/v1/auth/login
curl -s -o /dev/null -w "traccar: %{http_code}\n" https://traccar.trackgo.site/api/server

# 2. Versão nova está de fato no ar
curl -s https://traccar.trackgo.site/api/server | grep -o '"version":"[^"]*"'
# esperado: "6.14.5"

# 3. Commit/imagem servidos (mesmo princípio do checklist de deploy do backend)
docker exec $(docker ps -q -f name=traccar-rastreamento) \
  grep -c skipLimit /opt/traccar/conf/traccar.xml
# deve retornar 1 — confirma que o container novo está lendo o traccar.xml certo
```

```bash
# 4. Contrato REST contra a produção real (mesmo script, mesma checagem).
#    --base-url (não TRACCAR_BASE_URL) garante que o alvo é este e não um
#    TRACCAR_API_URL esquecido no ambiente; --sim-eu-sei-que-nao-e-local
#    confirma que rodar contra produção de verdade é intencional — o
#    script recusa por padrão contra qualquer alvo que não seja localhost.
python scripts/traccar-contrato.py \
  --base-url https://traccar.trackgo.site/api \
  --email admin@rastreamento21go.com.br \
  --password '<no 1Password>' \
  --sim-eu-sei-que-nao-e-local
```

```bash
# 5. O QUE REALMENTE IMPORTA: posições reais continuam chegando.
#    Não confundir device.lastUpdate (heartbeat) com fixTime real — ver
#    a regra de segurança do projeto sobre isso.
docker service logs --tail 200 rastreamento-21-go_traccar-rastreamento | grep -i "connected\|position"

# no dashboard/backend, escolher 2-3 veículos que sabidamente estavam
# em movimento antes do upgrade e conferir que fixTime segue avançando:
curl -s -b "<cookie de sessão admin>" \
  "https://traccar.trackgo.site/api/positions?deviceId=<id de um device real>" \
  | grep -o '"fixTime":"[^"]*"'
```

Só depois de ver posição nova com `fixTime` recente de pelo menos um
rastreador real em campo é que o upgrade está confirmado — não antes.

Janela esperada sem GPS durante o restart: ~30 s (rastreadores GT06
reconectam sozinhos, 4.000+ conexões em ~1 min — mesmo comportamento já visto
em reinícios anteriores do service).

---

## 7. Rollback

Só é seguro **com** o dump da seção 4. Voltar só a imagem, sem restaurar o
banco, **não funciona** — o Traccar 6.5 não conhece as colunas/tabelas que a
6.14.5 pode ter criado durante o boot, e o serviço sobe quebrado ou
inconsistente.

**Custo deste rollback — dizer com todas as letras, não deixar implícito:**
`pg_restore --clean` apaga o schema inteiro antes de recriar a partir do
dump. Isso **descarta permanentemente toda posição e todo evento gravados
entre o dump da seção 4 e o momento do rollback** — para um produto cujo
pior cenário é justamente "faltou uma posição durante um roubo", esse
período sem histórico é o preço real de reverter, não um detalhe técnico.
Quanto mais rápido se decidir por rollback depois do upgrade, menor essa
janela.

**Confirmar ANTES de rodar `--clean --if-exists`:** este comando presume que
`<nome-do-banco>` contém **só** o schema do Traccar. Em dev, Traccar e o
backend do 21 GO usam bancos separados (`traccar` vs. `rastreamento21go`) —
mas **o layout de produção não está documentado em lugar nenhum deste
repositório**. Se em produção os dois compartilharem o mesmo banco, este
`--clean` apaga dados do backend (veículos, alertas, tenants) junto com o
schema do Traccar. Confirmar o layout real antes de rodar:

```bash
PGCID=$(docker ps -q -f name=postgres-rastreamento)

# ver se existe mais de um banco de aplicação no mesmo Postgres
docker exec "$PGCID" psql -U postgres -c '\l'
# e, no banco alvo do restore, se as tabelas são só as do Traccar
# (tc_*, prefixo do schema do Traccar) e nada de outro schema (ex. tabelas
# do Prisma do backend, sem prefixo tc_)
docker exec "$PGCID" psql -U postgres -d <nome-do-banco> -c '\dt'
```

Se aparecer tabela que não é `tc_*` no mesmo banco do Traccar, **parar e
isolar antes de restaurar** — `--clean` ali destruiria dado do backend.

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77

# 1. Parar o Traccar
docker service scale rastreamento-21-go_traccar-rastreamento=0

# 2. Restaurar o dump de antes do upgrade (usar o mesmo <nome-do-banco> e
#    $STAMP anotados na seção 4)
PGCID=$(docker ps -q -f name=postgres-rastreamento)
docker cp "/root/traccar-pre-upgrade-$STAMP.dump" "$PGCID:/tmp/"
docker exec "$PGCID" pg_restore -U postgres -d <nome-do-banco> --clean --if-exists \
  "/tmp/traccar-pre-upgrade-$STAMP.dump"

# 3. Voltar a imagem
docker service update --force --image traccar/traccar:6.5 \
  rastreamento-21-go_traccar-rastreamento
docker service scale rastreamento-21-go_traccar-rastreamento=1

# 4. Repetir a seção 6 (verificação) inteira antes de considerar resolvido
```

Replicar a volta de imagem na UI do EasyPanel também, pelo mesmo motivo da
seção 5.

---

## 8. O que esperar depois — o que olhar, não o que prometer

- **Descartes por `outdated` (GPS week rollover, fix da 6.9).** Hoje medimos
  ~962 descartes/hora por data ruim. A hipótese é que a 6.14.5 reduz isso —
  **é hipótese, não fato**: confirmar comparando o volume de descartes
  `outdated` de uma semana antes contra uma semana depois do upgrade, não
  presumir que melhorou só porque a versão mudou.
- **Escrita mais leve no banco (write batching da 6.14).** A 6.5 grava
  posição uma a uma; isso importa porque acabamos de triplicar a carga
  baixando o `filter.skipLimit`/timer do parque de 30 s pra 10 s. Olhar
  I/O e conexões do Postgres antes/depois é o jeito de confirmar, não achismo.
- Mudanças que existem na 6.14.5 mas que não estamos indo atrás agora:
  tabela `tc_actions` (auditoria nativa, 6.7), filtro de posição por
  device/grupo em vez de global (6.13), busca retroativa por geofence na API
  (6.10), snap-to-road (6.14). Ficam registradas aqui como coisas que passam
  a existir, não como trabalho pendente deste runbook.

---

## Referências

- [.superpowers/sdd/etapa2-traccar-evidencias.md](../.superpowers/sdd/etapa2-traccar-evidencias.md) — evidências medidas que embasam este runbook.
- [scripts/traccar-contrato.py](../scripts/traccar-contrato.py) — script de contrato REST usado nas seções 3 e 6.
- [DEPLOY.md](DEPLOY.md) — infraestrutura, credenciais e runbook geral de incidentes.
- [DECISIONS.md](DECISIONS.md) — ADRs do projeto (nomenclatura de serviços, DNS, templates SMS).
