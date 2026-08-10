# Validar instalação antes de associar no SGA

**Data:** 2026-08-10
**Origem:** pedido do dono, espelhando o fluxo que já existe no RedeVeiculos (`21go.rastreamento.vip`).

## Problema

Hoje o operador associa o rastreador ao cliente no SGA sem nenhuma prova de que ele foi
instalado direito. O defeito só aparece no dia do roubo. No concorrente, o menu do estoque
tem **"Validar instalação"** antes de **"Associar um cliente e ativo"** — e o painel mostra
voltagem, ignição, GPS, satélites e última comunicação ao vivo.

No 21 GO o item **já existe no menu, desabilitado com selo "em breve"**
([page.tsx:496](../../../frontend/dashboard/src/app/(dashboard)/estoque/page.tsx#L496)).

Duas peças faltam:

1. **Ninguém vê voltagem e ignição.** O `TechFieldService.signal()` confere GPS mas ignora
   `power` e `ignition`, e é exclusivo do PWA do técnico.
2. **O rastreador em estoque não existe no servidor GPS.** O device no Traccar só nasce no
   `associate()` ([stock.service.ts:336](../../../backend/src/modules/stock/stock.service.ts#L336)).
   Sem device, o Traccar descarta o que o equipamento manda — não há o que exibir.

## Decisões tomadas com o dono

| Pergunta | Decisão |
|---|---|
| Trava o Associar? | **Não.** O selo informa, nunca bloqueia. |
| Ao vivo ou snapshot? | **Ao vivo**, refresh a cada 10 s — é assim que se vê a ignição virar. |
| Quem entra no Traccar? | **Estoque inteiro**, mais os cards Conectados / Desconectados / Sem GPS. |
| Guarda registro? | **Sim.** Selo com data, usuário e retrato da telemetria. |
| Arquitetura | **Leitura direta do Traccar** com cache curto. Nada de posição de estoque no nosso Postgres. |

## Fluxo

Técnico instala → operador abre **Estoque** → clica em **Validar** (botão ao lado de
*Associar (SGA)*) → painel lateral ao vivo → pede ao técnico girar a chave e confere a
ignição virar e a voltagem subir de ~12,6 V para ~14 V → **Aprovar** → selo na linha →
**Associar (SGA)**.

## Semáforo

| Checagem | Passa | Reprova |
|---|---|---|
| Comunicando | reportou nos últimos 5 min | chip mudo |
| GPS real | `assessPosition` aprova, fix ≤ 5 min, ≥ 4 satélites | LBS, fix velho, sem posição |
| Alimentação | 11,5–15,0 V (12 V) ou 23,0–30,0 V (24 V) | fora de faixa **ou não reportada** |
| Ignição | o equipamento reporta o estado | atributo ausente (fio não ligado) |

Detecção do sistema elétrico: `power > 18 V` → 24 V, senão 12 V.
Ignição **desligada não reprova** — carro parado é o normal. Reprova é o rastreador não saber
informar.

## Arquitetura

### `DeviceHealthService` (módulo `traccar`)

Diagnóstico único, consumido pelo painel e pelo PWA do técnico:

```
diagnose(imei, { refLat?, refLng?, ensureDevice? }) → DeviceHealth {
  encontradoNoGps, comunicando, lastUpdate,
  gps:     { ok, fixTime, satellites, latitude, longitude, address, idadeSegundos },
  energia: { volts, sistema: '12V'|'24V'|null, faixa: 'ok'|'baixa'|'alta'|'ausente' },
  ignicao: { reportada, ligada },
  velocidade, direcao, distanceM,
  checkOk, motivos[]
}
```

`TechFieldService.signal()` passa a ser um adaptador em cima dele — mesmo contrato público
(`SignalResult`), agora com voltagem e ignição a mais. Comportamento atual preservado:
fix ≤ 5 min, ≤ 500 m do técnico, override no `finish`.

### Endpoints (`stock`)

| Rota | Papel |
|---|---|
| `GET /stock/:id/signal` | diagnóstico ao vivo de um item — sem cache |
| `POST /stock/:id/validate` | grava o selo `{ approved, notes? }` com o retrato |
| `GET /stock/connectivity` | cards e pontinhos da lista — cache de 30 s em memória |

Roles: `SUPER_ADMIN`, `ADMIN`, `OPERATOR`. Tudo filtrado por `tenantId`.

### `StockTraccarSyncService`

- **No import da planilha:** cada IMEI novo vira device no Traccar (nome = IMEI), em lotes,
  best-effort.
- **Cron de 30 min:** `StockItem` sem `traccarDeviceId` → `getDeviceByUniqueId() ?? createDevice()`.
- **Ao abrir o painel:** garante o device na hora, para o caso de o item ter entrado enquanto
  o Traccar estava fora.
- **Nunca apaga device do Traccar** — apagar leva junto o histórico de posições.

Ajuste obrigatório em [stock.service.ts:334-337](../../../backend/src/modules/stock/stock.service.ts#L334-L337):
o device agora **vai** existir com o IMEI de nome, então o `associate()` precisa renomear
para a placa (`updateDevice`), senão o mapa mostra carro chamado "866557084669664".

### Migration aditiva em `stock_items`

```prisma
traccarDeviceId    Int?      @map("traccar_device_id")
validatedAt        DateTime? @map("validated_at")
validatedById      String?   @map("validated_by_id") @db.Uuid
validationOk       Boolean?  @map("validation_ok")
validationNotes    String?   @map("validation_notes")
validationSnapshot Json?     @map("validation_snapshot")
```

Todos opcionais — nenhuma linha existente quebra.

## Erros

| Situação | Tela |
|---|---|
| Traccar fora | "servidor GPS indisponível", botões de aprovar/reprovar desabilitados |
| IMEI sem device | cria na hora, "aguardando o primeiro pacote do rastreador…" |
| Nunca reportou | "esse equipamento nunca se conectou" |
| Protocolo sem voltagem | "voltagem não reportada por esse modelo", em cinza |

## Testes

- Classificação de voltagem: 12,63 V → 12 V ok; 27,4 V → 24 V ok; 10,8 V → baixa;
  ausente → ausente; fronteira em 18 V.
- Semáforo: device ausente, LBS, fix velho, sem `power`, sem `ignition`, tudo verde.
- Não-regressão do `signal()` do técnico após a refatoração.

## Pendência anotada, fora desta entrega

Com o estoque inteiro no Traccar, o servidor passa a gravar posição de equipamento parado na
prateleira. O `filter.distance` de 10 m ([traccar.xml:53](../../../docker/traccar/traccar.xml#L53))
segura a maior parte, mas 500 equipamentos ligados somam. O **P2.2** do
[PLANO-PRODUCAO-ZERO-ERRO](../../PLANO-PRODUCAO-ZERO-ERRO.md) já prevê poda de `tc_positions` —
acompanhar o crescimento depois desta entrega.
