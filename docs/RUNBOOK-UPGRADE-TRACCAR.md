# Runbook — Upgrade do Traccar 6.5 → 6.14.5 em produção

Documento operacional para quem for executar o upgrade do motor GPS em produção
(`traccar-rastreamento`, serviço EasyPanel do projeto `rastreamento-21-go`).
Segue o mesmo formato de [DEPLOY.md](DEPLOY.md) — leia aquele documento primeiro
se não conhece a infraestrutura.

As evidências que embasam este runbook estão medidas, não presumidas, em
[.superpowers/sdd/etapa2-traccar-evidencias.md](../.superpowers/sdd/etapa2-traccar-evidencias.md):
16/16 endpoints REST usados pelo backend compatíveis, WebSocket compatível, 25
chaves de config conferidas uma a uma contra `Keys.java` da tag `v6.14.5`.

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

## 1. Baseline — confirmar que está tudo 200 ANTES de mexer

Regra do projeto: nunca mexer em produção sem saber o estado de antes. Rodar
e **anotar** o resultado de cada comando:

```bash
curl -s -o /dev/null -w "dashboard: %{http_code}\n" https://trackgo.site
curl -s -o /dev/null -w "api: %{http_code}\n" https://api.trackgo.site/api/v1/auth/login
curl -s -o /dev/null -w "traccar: %{http_code}\n" https://traccar.trackgo.site/api/server

# versão atual — guardar esse número para comparar depois do upgrade
curl -s https://traccar.trackgo.site/api/server | grep -o '"version":"[^"]*"'
```

Esperado hoje: os três primeiros `200`, e `"version":"6.5"` (ou o que estiver
efetivamente publicado — não presumir, ler o retorno).

Se qualquer um dos três não for 200, **pare aqui**. Resolver o que já está
quebrado é prioridade sobre o upgrade (ver Regra 0 do projeto).

---

## 2. Backup do banco — não é opcional

As migrações do Traccar (Liquibase) **não são reversíveis**. Não existe
`liquibase rollback` de fábrica configurado neste projeto. O backup de antes
do upgrade é a **única** forma de voltar atrás se algo der errado — sem ele,
"reverter a imagem" não desfaz o schema.

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77

# 1. Descobrir o banco exato que o Traccar de produção usa —
#    não presumir o nome, ler do próprio traccar.xml publicado:
cat /etc/easypanel/projects/rastreamento-21-go/traccar-rastreamento/traccar.xml \
  | grep 'database.url'
# ex.: jdbc:postgresql://postgres-rastreamento:5432/<nome-do-banco>

# 2. Dump desse banco específico, de dentro do container do Postgres:
PGCID=$(docker ps -q -f name=postgres-rastreamento)
STAMP=$(date +%Y%m%d-%H%M)
docker exec "$PGCID" pg_dump -U postgres -d <nome-do-banco> -F c \
  -f "/tmp/traccar-pre-upgrade-$STAMP.dump"

# 3. Copiar o dump para fora do container e do droplet (não deixar só em /tmp) —
#    tirar do container:
docker cp "$PGCID:/tmp/traccar-pre-upgrade-$STAMP.dump" \
  "/root/traccar-pre-upgrade-$STAMP.dump"
# e da VPS pra sua máquina:
exit  # sai do SSH
scp -i ~/.ssh/claude_21go \
  root@167.71.31.77:/root/traccar-pre-upgrade-$STAMP.dump .
```

Confirmar que o arquivo chegou e não está vazio (`ls -lh`) antes de prosseguir.
Guardar o `$STAMP` usado — é o nome do arquivo que a seção 6 (rollback) pede de volta.

---

## 3. Fatos da migração (o que muda no schema)

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

---

## 4. Validar em ambiente descartável ANTES de tocar em produção

Nunca testar upgrade de motor de GPS direto em produção. Suba um container
solto, sem tocar no Swarm:

```bash
docker run -d --name traccar-upgrade-teste -p 8092:8082 traccar/traccar:6.14.5

# primeiro usuário criado sem sessão vira administrador (bootstrap do Traccar)
curl -X POST http://localhost:8092/api/users -H 'Content-Type: application/json' \
  -d '{"name":"admin","email":"admin@teste.local","password":"<escolha uma senha>"}'

python scripts/traccar-contrato.py \
  --base-url http://localhost:8092/api \
  --email admin@teste.local \
  --password '<a senha escolhida acima>'
```

Esperado: `17/17 OK`, saída `0`. Se alguma linha falhar, **não prosseguir** —
investigar antes de tocar em produção. Ao terminar:

```bash
docker rm -f traccar-upgrade-teste
```

---

## 5. Upgrade em produção

Com o baseline (seção 1) e o backup (seção 2) feitos, e o teste descartável
(seção 4) todo verde:

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
# 1. Os três domínios continuam 200
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
# 4. Contrato REST contra a produção real (mesmo script, mesma checagem)
TRACCAR_BASE_URL=https://traccar.trackgo.site/api \
TRACCAR_EMAIL=admin@rastreamento21go.com.br \
TRACCAR_PASSWORD='<no 1Password>' \
python scripts/traccar-contrato.py
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

Só é seguro **com** o dump da seção 2. Voltar só a imagem, sem restaurar o
banco, **não funciona** — o Traccar 6.5 não conhece as colunas/tabelas que a
6.14.5 pode ter criado durante o boot, e o serviço sobe quebrado ou
inconsistente.

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77

# 1. Parar o Traccar
docker service scale rastreamento-21-go_traccar-rastreamento=0

# 2. Restaurar o dump de antes do upgrade (usar o mesmo <nome-do-banco> e
#    $STAMP anotados na seção 2)
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
- [scripts/traccar-contrato.py](../scripts/traccar-contrato.py) — script de contrato REST usado nas seções 4 e 6.
- [DEPLOY.md](DEPLOY.md) — infraestrutura, credenciais e runbook geral de incidentes.
- [DECISIONS.md](DECISIONS.md) — ADRs do projeto (nomenclatura de serviços, DNS, templates SMS).
