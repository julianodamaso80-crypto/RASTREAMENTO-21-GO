# Runbook — Geocoder self-hosted (traccar-geocoder)

Documento operacional para quem for implantar o geocoder reverso próprio em
produção. Segue o mesmo formato de [DEPLOY.md](DEPLOY.md) — leia aquele
documento primeiro se não conhece a infraestrutura.

As evidências que embasam este runbook estão medidas, não presumidas, em
[.superpowers/sdd/etapa3-geocoder-evidencias.md](../.superpowers/sdd/etapa3-geocoder-evidencias.md):
formato da API real, campos que o geocoder emite e não emite, fluxo de auth e
um risco de segurança do primeiro login.

**Este runbook não foi executado em produção.** Ninguém com acesso a este
repositório tinha SSH pro droplet no momento em que foi escrito — só o código
do backend (com fallback automático), o compose de dev e esta documentação
foram feitos. Quem for rodar em produção é quem primeiro executa os passos
abaixo de verdade, e precisa medir disco/RAM do droplet antes (seção 2) — os
números abaixo são os do README do projeto, não os do nosso servidor.

---

## 1. O que isto substitui e por quê

Hoje o endereço de cada veículo vem do **Nominatim público** do OpenStreetMap,
que limita a 1 consulta por segundo. `reverse-geocode.service.ts` respeita
isso com um portão de 1 req/s e backoff de 10 minutos ao levar `429`. Quando o
limite estoura, **o endereço some de todas as telas ao mesmo tempo** — e o
cenário que estoura é justamente o pior: segunda de manhã, centenas de
veículos em movimento, o painel pedindo endereço para todos de uma vez.

O `traccar/traccar-geocoder` roda na nossa própria infraestrutura, com
resposta **compatível com o formato do Nominatim** (`display_name` e
`address.*` nos mesmos nomes) e sem limite externo. Por isso a mudança no
backend é uma troca de provedor, não uma reescrita — ver `GEOCODER_URL` e
`GEOCODER_API_KEY` abaixo.

**A troca é opt-in a qualquer momento**: com as duas variáveis vazias, o
backend continua batendo no Nominatim exatamente como hoje.

**E também é resiliente em runtime.** Com o geocoder próprio configurado, se
uma consulta falhar (erro de rede, status não-OK, corpo que não parseia) ou o
provedor estiver de castigo por um `429` anterior, `ReverseGeocodeService`
cai pro Nominatim nessa MESMA consulta — uma tentativa, nunca em loop (ver
`resolver()` em [reverse-geocode.service.ts](../backend/src/modules/geocoding/reverse-geocode.service.ts)).
Cada provedor tem seu próprio castigo (`bloqueadoAteProprio` /
`bloqueadoAteNominatim`) — um `429` de um nunca silencia o outro.

**Limite disso:** a chamada de fallback ainda respeita o portão de 1 req/s do
Nominatim (a política do OSM não deixa de valer só porque chegamos até ele via
fallback). Numa indisponibilidade total do geocoder próprio, o endereço volta
a resolver — mas no ritmo lento de sempre, não instantaneamente. Ver seção 7.4
para o que observar quando isso está acontecendo.

---

## 2. Antes de começar — conferir recursos do droplet

O README do `traccar/traccar-geocoder` declara **~18 GB de disco e 16 GB de
RAM** para indexar o **planeta inteiro**. O Brasil sozinho é uma fração disso
— a Geofabrik publica o extrato do país separado:
`https://download.geofabrik.de/south-america/brazil-latest.osm.pbf`.

**O tamanho real do índice do Brasil não foi medido nesta sessão** (sem
acesso SSH ao droplet `21-GO-SERVIDOR`). Antes de indexar o Brasil em
produção:

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77
df -h        # espaço livre em disco
free -h      # RAM disponível
```

Se o droplet não tiver folga clara acima do que a indexação vai consumir,
**não prosseguir** — ou reduzir o escopo (indexar só os estados onde temos
frota, se o binário permitir extratos regionais da Geofabrik) ou provisionar
mais disco/RAM antes.

---

## 3. Criar a conta admin ANTES de a porta ficar acessível

**Isto é um passo de segurança, não um detalhe de setup.** Lido de
`server/src/auth.rs:185-190`: o primeiro `POST /login` que chegar ao serviço
cria a conta administradora — não existe senha padrão. Quem abrir a porta
primeiro **vira dono do serviço**, com acesso a criar/apagar tokens e outros
usuários.

Consequência prática: **nunca publicar a porta do geocoder pro mundo externo**
antes de logar uma vez e criar a conta. Em produção isso é resolvido pela
própria arquitetura — o backend fala com o geocoder pela rede interna do
Docker Swarm, sem a porta precisar sair pra internet nunca.

Passo a passo:

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77

# suba o container, SEM publicar porta pro host, direto na rede do Swarm
# (ou publique em localhost e acesse via túnel SSH — nunca em 0.0.0.0)
docker run -d --name geocoder-setup \
  -e PBF_URLS="https://download.geofabrik.de/south-america/brazil-latest.osm.pbf" \
  -v geocoder_data:/data \
  -p 127.0.0.1:3000:3000 \
  traccar/traccar-geocoder

# do seu computador, túnel até o droplet (a porta nunca fica exposta na internet)
ssh -i ~/.ssh/claude_21go -L 3000:localhost:3000 root@167.71.31.77
```

Com o túnel aberto, abra `http://localhost:3000/login` no navegador e crie o
usuário admin com uma senha forte (vai pro 1Password, cofre `Rastreamento
21GO`, junto dos outros admins do projeto — ver [DEPLOY.md §4](DEPLOY.md#4-credenciais-referência--valores-no-1password)).

---

## 4. Gerar o token de API

Já logado como admin (seção 3), na mesma tela:

- Clicar em **Create Token** — gera uma chave hex de 32 caracteres.
- Essa chave é o valor de `GEOCODER_API_KEY` no backend (seção 6). Vai no
  1Password, **nunca commitada** em arquivo nenhum (regra do projeto).
- Delete tokens antigos que não estejam em uso (`/tokens/{token}/delete`) —
  cada um é uma credencial válida enquanto existir.

---

## 5. Buildar o índice

O índice é construído no boot do container, a partir da(s) URL(s) em
`PBF_URLS` (múltiplas, separadas por vírgula, se precisar combinar extratos).

| Extrato | Uso | Tempo observado |
|---|---|---|
| `europe/monaco-latest.osm.pbf` | teste rápido (é o que valida a integração neste runbook) | ~90 s |
| `south-america/brazil-latest.osm.pbf` | produção | **não medido** — ver seção 2 antes de rodar |

```bash
# acompanhar o boot/indexação
docker logs -f geocoder-setup
```

Só depois do índice pronto (log para de mostrar progresso de importação) é
que `/reverse` passa a responder com endereço de verdade.

---

## 6. Configurar o backend

Duas variáveis novas, lidas em [backend/src/config/configuration.ts](../backend/src/config/configuration.ts)
(seção `geocoder`) e consumidas em [reverse-geocode.service.ts](../backend/src/modules/geocoding/reverse-geocode.service.ts):

| Variável | Obrigatória | Efeito |
|---|---|---|
| `GEOCODER_URL` | não | Base URL do geocoder próprio, ex. `http://geocoder-rastreamento:3000` (nome do service no Swarm, sem porta publicada). |
| `GEOCODER_API_KEY` | não | Token gerado na seção 4. |

**As duas precisam estar setadas juntas.** Faltando qualquer uma, o serviço
cai no Nominatim público — sem erro, sem crash-loop, só volta ao
comportamento de hoje.

```bash
# produção (mesma mecânica de qualquer env var do backend — ver DEPLOY.md §5)
docker service update \
  --env-add GEOCODER_URL=http://geocoder-rastreamento:3000 \
  --env-add GEOCODER_API_KEY='<token do 1Password>' \
  rastreamento-21-go_backend-rastreamento
```

Replicar as duas variáveis também na UI do EasyPanel (`Environment` do
service), senão um próximo "Deploy" pela UI reverte — mesmo drift documentado
em [DEPLOY.md §5](DEPLOY.md#5-como-fazer-deploy).

---

## 7. Verificar que funciona

### 7.1 O geocoder responde direto

```bash
curl -s "http://<host-interno-ou-túnel>:3000/reverse?lat=-22.9068&lon=-43.1729&key=<TOKEN>"
# esperado: {"display_name":"...","address":{"road":"...","city":"Rio de Janeiro","state":"Rio de Janeiro",...}}
```

Sem `key`, `/reverse` responde `401` — se isso não acontecer, o token está
errado ou não foi enviado.

### 7.2 O backend está de fato usando o geocoder próprio, não caindo em silêncio no Nominatim

Como o fallback é silencioso por desenho (é o que protege o endereço de
sumir), **confirmar visualmente não basta** — o Nominatim também devolveria
endereço válido pro mesmo ponto. Formas de confirmar qual provedor respondeu:

- **Latência.** O geocoder próprio responde em milissegundos, na rede
  interna; o Nominatim público tem latência de rede real + o portão de 1 req/s
  (`INTERVALO_MS` em `reverse-geocode.service.ts`). Um lote de endereços
  resolvendo bem mais rápido que ~1 por segundo é sinal de que o provedor
  próprio está ativo.
- **Desligar o geocoder de propósito** (`docker service scale
  ..._geocoder-rastreamento=0`) num ambiente de teste e confirmar que o
  **fallback entra em ação** — o endereço continua resolvendo, só que no
  ritmo do Nominatim (1 por segundo) em vez de instantâneo. Se o endereço
  **parar** de resolver com o geocoder próprio fora do ar, é o fallback que
  quebrou — o comportamento esperado é degradar, nunca parar.
- **Log de erro do provedor, se algo falhar.** As mensagens de warning que o
  serviço emite em caso de `429` ou resposta não-OK citam o provedor pelo nome
  (`"Geocoder próprio respondeu..."`, `"Geocoder próprio falhou..."` vs.
  `"Nominatim respondeu..."`, `"Nominatim falhou..."`) — não aparece nada em
  requisição que deu certo, mas se o backend estiver caindo no fallback com
  frequência, é aqui que aparece:

```bash
docker service logs --tail 200 rastreamento-21-go_backend-rastreamento | grep -i "geocoder próprio\|nominatim"
```

### 7.3 Prova ponta a ponta (o que validou esta implementação)

Contra um container de teste (Mônaco, índice pequeno, ~90 s de build):

```
GET /reverse?lat=43.7384&lon=7.4246&key=<TOKEN>
→ 200 {"display_name":"Gallerie Charles Despeaux, 98000 Monaco, Monaco", ...}
```

E via `ReverseGeocodeService.lookupNow()` de verdade (não mock), apontado pra
esse mesmo container: `"Gallerie Charles Despeaux - Monte-Carlo, Monaco"` —
confirma que o parsing, a montagem do endereço e a chamada HTTP real fecham
ponta a ponta.

### 7.4 Enquanto estiver em produção — o que observar quando o geocoder cair

O fallback é silencioso por desenho: quando o geocoder próprio falha, o
operador que só olha a tela **não percebe nada** — o endereço continua
aparecendo. É exatamente por isso que "degradado, mas funcionando" é fácil de
passar batido. Sinais de que o fallback está ativo (não de que algo parou):

- **Log de warning repetido** com `"Geocoder próprio respondeu..."` ou
  `"Geocoder próprio falhou..."` seguido, logo depois, de uma chamada ao
  Nominatim para a mesma coordenada — é o padrão esperado de uma consulta que
  caiu no fallback.
- **Lentidão perceptível na primeira resolução de cada endereço novo.** Com o
  geocoder próprio no ar, a resolução é em milissegundos, na rede interna. Em
  fallback, cada endereço novo (o cache por proximidade continua valendo para
  os já resolvidos) passa a esperar o portão de 1 req/s do Nominatim — em um
  parque com muitos veículos se movendo ao mesmo tempo, isso é visível como
  atraso pra aparecer o endereço de ativos recém-instalados ou fora da área já
  cacheada.
- **`bloqueadoAteProprio` sistematicamente no futuro** (não observável direto,
  mas o sintoma é: toda consulta do período cai em fallback, não só uma
  isolada) indica que o geocoder próprio está recusando por excesso de
  chamadas (`429`) ou fora do ar — vale checar `docker service ps
  ..._geocoder-rastreamento` nesse caso.

Nenhum alerta automático dispara nesse cenário — hoje a única forma de saber
que o geocoder próprio está indisponível é olhar os logs acima ou notar a
lentidão.

---

## 8. Rollback

Não precisa de banco, não precisa de restore — é só desfazer a configuração:

```bash
docker service update \
  --env-rm GEOCODER_URL \
  --env-rm GEOCODER_API_KEY \
  rastreamento-21-go_backend-rastreamento
```

Replicar a remoção na UI do EasyPanel também. No próximo request de
endereço, o backend volta a bater no Nominatim público — nenhum dado é
perdido: o cache de endereços já resolvidos (`geo_addresses`) continua válido
independente de qual provedor o gerou, porque o formato salvo é o mesmo texto
formatado (`rua - bairro, cidade - UF`) nos dois casos.

---

## 9. Limitação conhecida — o Nominatim público não fica vago

Este runbook tira a maior parte do tráfego de geocodificação reversa (mapa,
listas de veículos) do Nominatim público. Mas **dois outros consumidores no
mesmo egress IP continuam batendo lá**, e nenhum dos dois pode migrar para o
geocoder próprio hoje:

- [backend/src/modules/installation-pendings/geocoding.service.ts](../backend/src/modules/installation-pendings/geocoding.service.ts)
  (`viaNominatim`, ~linha 113-140) faz **geocodificação direta** (endereço →
  coordenada, `/search`) para resolver CEP em coordenada quando a AwesomeAPI
  não cobre. O `traccar-geocoder` self-hosted **não tem endpoint `/search`** —
  só `/reverse` e `/snap` (ver
  [etapa3-geocoder-evidencias.md](../.superpowers/sdd/etapa3-geocoder-evidencias.md)).
  Não há para onde migrar esse consumidor sem trocar de motor.
- [docker/traccar/traccar.xml](../docker/traccar/traccar.xml) (~linha 44-46)
  configura o **próprio Traccar** para geocodificar contra
  `nominatim.openstreetmap.org` — independente do backend, com sua própria
  política de uso.

**Consequência.** Se o OpenStreetMap resolver bloquear ou throttlar o IP do
droplet por causa de qualquer um desses dois caminhos, o fallback deste
runbook (seção 1 e 7.4) degrada exatamente no momento em que mais precisa
funcionar — porque o Nominatim, que é o destino do fallback, é o mesmo que
está sendo throttled pelos outros dois consumidores.

**Antes de considerar isso resolvido em produção**, checar se o
`traccar.xml` **publicado no droplet** (bind mount, não commitado neste repo)
tem a mesma configuração `geocoder.type=nominatim` do arquivo de dev — só a
cópia de dev está visível aqui, e a de produção pode já ter sido alterada ou
não.

---

## Referências

- [.superpowers/sdd/etapa3-geocoder-evidencias.md](../.superpowers/sdd/etapa3-geocoder-evidencias.md) — evidências medidas que embasam este runbook.
- [backend/src/modules/geocoding/reverse-geocode.service.ts](../backend/src/modules/geocoding/reverse-geocode.service.ts) — implementação, portão de 1/s e mapa de siglas de UF.
- [docker/docker-compose.yml](../docker/docker-compose.yml) — service `geocoder` para desenvolvimento local.
- [DEPLOY.md](DEPLOY.md) — infraestrutura, credenciais e runbook geral de incidentes.
