# K-Tag na rede Find My — desenho do worker

**Data:** 2026-08-20
**Status:** aprovado pelo dono (abordagem A)

## Problema

A K-Tag (TrackerKing, também vendida como WGPSTAG/REDETAG) é uma etiqueta Bluetooth que
emite o protocolo Apple Find My. Ela não tem GPS nem chip de celular: quem descobre onde ela
está é o iPhone de um estranho que passa perto e reporta para a Apple.

O valor dela para o 21 GO é específico: **bloqueador de sinal não a desliga**. Quando o
ladrão liga o jammer e o rastreador principal emudece, o Bluetooth da TAG continua piscando.
Ela é a camada que sobrevive à neutralização do rastreador — devagar, mas viva.

A POC de abril/2026 travou antes de provar isso, e ficou parada quatro meses.

### Por que travou (descoberto em 20/08/2026)

1. **2FA por SMS quebrado.** Confirmado por três pessoas na issue #224 do macless-haystack:
   a saída é `--trusteddevice`, que empurra o código para um iPhone vinculado à conta.
2. **Trust score da conta.** A Apple recusa devolver dados de Find My para conta recém-criada
   que nunca logou num aparelho real nem abriu o app "Buscar". A conta
   `7growthvendas@gmail.com` foi criada em 27/04/2026 exatamente para isso — é o perfil que
   ela recusa.
3. **IP de datacenter bloqueado.** O plano escrito no README da POC era subir o worker na
   DigitalOcean. A Apple bloqueia Find My vindo de datacenter, e **DigitalOcean encabeça a
   lista** de provedores afetados. O golpe é silencioso: login retorna 200 OK e a busca
   devolve lista vazia.

## Expectativa acordada

O dono pediu "tempo real" e esclareceu: **o menor tempo que a tecnologia permitir**.

A latência real da rede Find My é de 1–15 min em área urbana e de 30 min a horas onde passa
pouca gente. Isso é físico, não é ajustável por software: sem iPhone por perto, não existe
posição para buscar. O desenho abaixo persegue o mínimo possível dentro desse limite, e a
interface **nunca** apresenta posição de TAG como se fosse tempo real.

## O que já existe (verificado no código em 20/08/2026)

Mais da metade do trabalho está feita desde a migration `20260428190820_add_ble_tags`:

| Peça | Onde | Estado |
|---|---|---|
| `model BleSighting` | `backend/prisma/schema.prisma` | pronto |
| `BLE_KTAG`, `BLE_REDTAG`, `BLE_AIRTAG_GENERIC` | enum `DeviceModel` | pronto |
| Módulo `ble-tags` (controller, service, DTOs) | `backend/src/modules/ble-tags/` | pronto |
| `POST /ble-tags/sightings` | idem | pronto |
| Emissão em WebSocket | `setEmitter` no service | pronto |
| Tela `/etiquetas-ble` | `frontend/dashboard/src/app/(dashboard)/etiquetas-ble/` | pronto |
| Scanner BLE local (Python + bleak) | `poc-ktag-findmy/scanner/` | pronto, validado |
| **Worker Find My** | — | **não existe** |

A TAG física já foi validada: MAC `0E:02:3C:02:25:EB`, emitindo payload Find My tipo `0x12`
a cada ~2s, com chaves extraídas em `poc-ktag-findmy/keys/ktag-92603008494.json`.

## Escopo desta entrega

Construir o worker que falta e as poucas costuras que ele exige. **Fora de escopo** (YAGNI
até a TAG provar que funciona): rastreamento BLE pelo app dos associados, antenas fixas
ESP32, e venda da TAG como produto.

## Arquitetura

Quatro peças, com uma regra de fronteira: **o backend decide, o worker obedece.** O worker
não conhece regra de negócio — ele pergunta o que buscar, busca, e entrega.

```
┌──────────────────────┐
│  Apple Find My       │
└──────────┬───────────┘
           │ HTTPS via proxy residencial
┌──────────▼───────────┐      GET /ble-tags/polling-plan
│  ktag-findmy-worker  │◄──────────────────────────────┐
│  (Python, droplet)   │                               │
│  - FindMy.py         │      POST /ble-tags/sightings │
│  - anisette-v3       │──────────────────────────────►│
└──────────────────────┘                    ┌──────────┴─────────┐
                                            │  backend NestJS    │
┌──────────────────────┐                    │  módulo ble-tags   │
│  scanner BLE local   │───────────────────►│  (já existe)       │
│  (já existe)         │  mesma rota        └──────────┬─────────┘
└──────────────────────┘                               │ WebSocket
                                            ┌──────────▼─────────┐
                                            │  /etiquetas-ble    │
                                            └────────────────────┘
```

Escolher Python para o worker não é preferência: `FindMy.py` é Python, é a biblioteca viva
do ecossistema (3.209 estrelas, atualizada em 12/08/2026, MIT) e ganhou em 04/05/2026 suporte
a acessório de chave pré-gerada — que é exatamente o caso da K-Tag. O `macless-haystack` da
POC teve 8 commits desde março, todos de conserto de build, e é GPL.

### Componente 1 — `ktag-findmy-worker`

Processo Python isolado, em container próprio no droplet. Uma responsabilidade: traduzir
relatórios da rede Find My em chamadas ao nosso endpoint.

**Ciclo:**
1. `GET /ble-tags/polling-plan` → lista de TAGs e o intervalo de cada uma.
2. Agrupa as chaves em **uma única requisição** à Apple (chaves estáticas entram em lote —
   `reports.py:399`). Mil TAGs cabem numa chamada.
3. Decifra os relatórios com a chave privada de cada TAG.
4. Descarta o que já foi enviado (deduplicação por `hashedAdvKey` + timestamp).
5. `POST /ble-tags/sightings` para cada relatório novo.

**Saída pela internet:** todo tráfego para a Apple passa pelo proxy residencial
(`HTTPS_PROXY`). O tráfego para o nosso backend **não** passa pelo proxy — vai direto.

**Autenticação na Apple:** sessão persistida em volume Docker. Login interativo é feito uma
vez, por `--trusteddevice`, com o código chegando no iPhone. A sessão é reutilizada; se cair,
o worker não tenta reautenticar sozinho — ele registra falha e alerta (ver Erros).

### Componente 2 — onde moram as chaves da TAG

Duas colunas novas em `Device`, aplicadas por migration aditiva:

- `bleAdvKeyPrivate String?` — chave privada, base64
- `bleAdvKeyHashed String?` — hash da advertisement key, base64

Ficam no banco, e não em arquivo no worker, por três motivos: são cadastro do equipamento
como o IMEI; o worker precisa saber quais TAGs existem **por tenant**; e um arquivo no
container não sobrevive a redeploy nem a uma segunda instância.

São segredo operacional: quem tem a chave privada consegue decifrar a posição da TAG. Não
entram em log, não voltam em `GET /ble-tags`, e só saem do banco pela rota do plano de
polling, restrita ao usuário de serviço.

### Componente 3 — `GET /ble-tags/polling-plan`

Rota nova no módulo `ble-tags`, exclusiva do worker. Devolve o que buscar e com que pressa:

```json
{
  "tags": [
    {
      "deviceImei": "92603008494",
      "privateKey": "...",
      "hashedAdvKey": "...",
      "mode": "TURBO",
      "intervalSeconds": 60,
      "backfillHours": 168
    }
  ]
}
```

**O worker opera dentro de um único tenant.** Ele autentica com um usuário de serviço, e
tanto o plano quanto a gravação de avistamentos usam o `tenantId` do JWT — como toda rota do
sistema. O plano não carrega `tenantId` no corpo justamente para que não exista caminho em
que o worker escreva fora do seu tenant. Se um segundo tenant passar a usar TAGs, sobe-se
outra instância do worker com a credencial dele.

**Aqui mora toda a regra de negócio.** O backend calcula o modo de cada TAG:

| Modo | Quando | Intervalo |
|---|---|---|
| `IDLE` | normal | 3600s |
| `TURBO` | rastreador do mesmo veículo calou (alerta `OFFLINE`, `GPS_SILENT`, `JAMMING` ou `POWER_CUT` aberto), **ou** operador acionou manualmente | 60s |

`backfillHours: 168` no primeiro ciclo após entrar em TURBO: a Apple guarda **7 dias** de
histórico (`reports.py:427`), então o acionamento puxa todo o rastro anterior de uma vez.
É por isso que não precisamos consultar o tempo todo só para ter histórico.

O acionamento manual é um botão na TAG em `/etiquetas-ble`, que grava
`bleTurboUntil DateTime?` em `Device` (terceira coluna nova). Turbo manual dura 6 horas e
pode ser renovado.

### Componente 4 — ajustes no que já existe

Três mudanças pequenas, todas obrigatórias:

1. **`rssi` vira opcional.** O DTO exige `rssi` entre -127 e 20. Relatório de Find My **não
   tem RSSI** — a posição vem do iPhone que ouviu, não da potência do sinal. Sem isso, todo
   relatório da Apple é rejeitado na validação.
2. **Campo `seenAt` em `BleSighting`.** Hoje só existe `createdAt`, que é quando *nós*
   gravamos. O relatório carrega **quando a TAG foi vista**, que pode ser horas antes. Misturar
   os dois repetiria o erro que a regra do projeto proíbe em posição de rastreador
   (`fixTime` ≠ `lastUpdate`) — e num roubo isso manda a equipe para onde o carro **estava**.
   `seenAt` é o carimbo que vale; `createdAt` fica para auditoria.
3. **`accuracy Int?` em `BleSighting`.** O relatório traz a confiança da posição. Sem ela a
   tela não tem como diferenciar posição boa de estimativa grosseira.

Na tela, toda posição de TAG aparece com a idade explícita — *"visto há 7 min"* — e com a
fonte (`Bluetooth próprio` ou `rede Apple`). Nunca com ícone de tempo real.

## Fluxo de dados

**Caso normal:** TAG pisca → iPhone de estranho ouve → Apple guarda → worker busca de hora em
hora → `POST /ble-tags/sightings` → `BleSighting` gravado → WebSocket → tela atualiza.

**Caso de roubo:** jammer liga → rastreador para de reportar → `alerts.cron` abre alerta
`JAMMING`/`GPS_SILENT` → próximo `polling-plan` marca a TAG como `TURBO` → worker passa a
buscar de minuto em minuto e puxa os 7 dias retroativos → cada posição nova cai na tela e no
WebSocket.

**Caso de pátio:** o scanner BLE local vê a TAG e reporta pela **mesma rota**, com
`scannerSource='ble-local'`. Latência de segundos. As duas fontes convivem na mesma tabela.

## Tratamento de erro

O modo de falha perigoso desta integração não é o erro barulhento — é o silêncio. A Apple
responde 200 OK com lista vazia tanto quando ninguém viu a TAG quanto quando nos bloqueou.
Confundir os dois é ficar meses achando que a TAG está fora de área.

| Situação | Como o worker reage |
|---|---|
| Proxy fora do ar | Não consulta a Apple sem proxy — falharia e queimaria reputação do IP do droplet. Registra e tenta no ciclo seguinte. |
| Sessão Apple expirada (401) | Para de consultar, marca `AUTH_FAILED` e alerta. Não tenta reautenticar sozinho: relogin exige o código no iPhone. |
| **Zero relatórios em todas as TAGs por 6 horas corridas** | Trata como **suspeita de bloqueio de IP**, não como ausência de posição, e alerta o time. O corte é em tempo, não em número de ciclos: em `TURBO` seis ciclos seriam seis minutos e gerariam alarme falso toda vez que o carro entrasse numa garagem. Se ao menos uma TAG reportou na janela, o silêncio das outras é normal. |
| Backend fora do ar | Guarda os relatórios em fila local e reenvia. Nada é perdido por indisponibilidade nossa. |
| Relatório repetido | Descartado pela deduplicação (`hashedAdvKey` + `seenAt`). |

## Como sabemos que funcionou

**Testes automatizados:**
- Decodificação de relatório: entrada gravada de um relatório real → posição esperada. Sem rede.
- Deduplicação: mesmo relatório duas vezes gera uma linha só.
- `polling-plan`: veículo com alerta `JAMMING` aberto sai `TURBO`; sem alerta sai `IDLE`;
  TAG de outro tenant nunca aparece no plano (regra multi-tenant).
- Rejeição de silêncio: seis ciclos vazios em todas as TAGs disparam o alerta de bloqueio.

**Teste de campo — este é o que decide se a tecnologia serve:**

Levar a TAG física para a rua por um dia útil no Rio e medir o que a rede realmente entrega:
quantas posições por hora, qual o atraso entre `seenAt` e a chegada, e qual o maior intervalo
sem nenhuma posição. Comparar com o trajeto real.

**Critério de aceite:** em área urbana movimentada, mediana de atraso **abaixo de 15 minutos**
e nenhuma janela cega maior que **1 hora**. Abaixo disso a TAG não sustenta a promessa de
"camada que sobrevive ao jammer", e a decisão de seguir volta para a mesa.

## Ordem de execução

1. Aquecer a conta Apple: logar num iPhone real, ligar o Buscar, abrir o app, aceitar os
   termos, esperar 24–48h. **Sem isso, nada do resto funciona.**
2. Contratar o proxy residencial (US$ 2–6/IP/mês) e validar o IP.
3. Login `--trusteddevice` e persistência da sessão.
4. Migration: `bleAdvKeyPrivate`, `bleAdvKeyHashed`, `bleTurboUntil` em `Device`; `seenAt` e
   `accuracy` em `BleSighting`; `rssi` opcional.
5. `GET /ble-tags/polling-plan` com os testes de modo e de isolamento por tenant.
6. Worker: ciclo, deduplicação, fila local, detecção de silêncio.
7. Ajuste da tela: idade da posição e fonte.
8. Teste de campo e decisão.

Os passos 1 e 2 são pré-requisitos externos e não dependem de código. O passo 8 é o que
autoriza — ou não — pensar em TAG como produto.

## Riscos assumidos

- **A chave da nossa TAG é fixa** (`additionalKeys: []`), enquanto um AirTag troca de
  identidade a cada ~15 min. Isso aumenta a chance de o iPhone do ladrão disparar o alerta
  de "item desconhecido viajando com você" e ele achar a TAG. A TAG é camada extra de chance,
  nunca garantia de recuperação — e assim deve ser comunicada ao associado.
- **Dependemos de comportamento não documentado da Apple.** Não existe contrato: a Apple pode
  bloquear a conta ou o IP a qualquer momento. Por isso a conta é descartável e o alerta de
  silêncio é parte do desenho, não enfeite.
- **O proxy residencial é um terceiro no caminho de um dado sensível.** O tráfego é HTTPS e o
  proxy não decifra conteúdo, mas ele vê com quem falamos. Se isso for inaceitável, a
  alternativa é o mini-PC com internet própria, que foi descartada nesta decisão.
