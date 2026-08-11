---
data: 2026-08-11
projeto: 21-GO-Rastreamento
tags: [clientes, ativos, sga, ui, paridade-competitiva]
tipo: decisão
---

# Clientes Ativos vira lista por ativo

## Contexto

A tela `/clientes` agrupa por cliente e mostra pouco: nome, CPF, contato, "Desde X",
e por veículo apenas placa, modelo, IMEI, instalador e local. O concorrente
(RedeVeiculos, instância `21go.rastreamento.vip`, 32.516 ativos) tem em `/veiculos/`
uma tela madura que o dono do produto quer replicar.

Levantamento feito na tela real do concorrente em 11/08/2026, navegando logado.

### O que o concorrente tem

**Aba Análises**
- Quantidade por tipo do ativo (Carro 18.560 · Moto 13.945 · Outros 10 · Caminhão 1) → 32.516
- Instalações mensais dos últimos 6 meses
- "Instalações realizadas em:" com seletor de semana → total + abas dom–sáb,
  cada dia listando os ativos instalados

**Aba Lista**
- Botões "Mais opções" (modal em lote: Marcar para retirada · Migração de ativos ·
  Retirar equipamentos) e "Exportar"
- Sub-abas "Total de ativos" | "Pré-cadastro"
- Busca única por nome, cpf, imei, placa, chassi, marca ou modelo
- Registros por página: 20 / 60 / 140 / 200 / 400 / 500
- FAB "+" para novo ativo
- **Não existem filtros.**

**Card**
- Ícone por tipo · marca+modelo · placa · IMEI · badge "Desabilitado no guardião"
- Dono · `GPRS: dd/mm/aa hh:mm` · `GPS: dd/mm/aa hh:mm` · técnico
- "Em dia" (verde) · "Acesso bloqueado" (vermelho)
- "Última atualização há X" · badge `SGA: <código> - <STATUS>`
  (vistos: ATIVO, INATIVO, CANCELADO, SUBSTITUIDO)

**Menu ⋮**
Abrir painel · Abrir no mapa · Ver/Editar Dados · Alterar Técnico ·
Adicionar a lista pendência · Ordens de Serviço · — · Alterar para Inadimplente ·
Adicionar consultor · Liberar acesso do cliente ao ativo

## Decisão

`/clientes` deixa de agrupar por cliente e vira lista por ativo, com as abas
**Análises** e **Lista**. Rota e rótulo do menu ficam como estão.

### Fora de escopo, com motivo

| Item do concorrente | Por que não |
|---|---|
| Ordens de Serviço | módulo não existe (Wave 2.2) |
| Adicionar consultor | não existe consultor no rastreamento |
| Badge do Guardião | Guardião não existe (Wave 2.1) |
| Adicionar a lista pendência | nossa lista de pendências é espelho do SGA; entrada manual criaria fantasma |
| Sub-aba "Pré-cadastro" | já existe como tela própria `/pendencias`; duplicar cria dois lugares com a mesma verdade |
| Migração de ativos | descartado na auditoria de 20/04/2026 (edge case raro) |

### Onde saímos do "igual"

O card do concorrente mostra GPRS e GPS lado a lado, ambos em cinza, sem julgamento.
Um ativo com GPRS vivo e GPS congelado há 8 horas — assinatura de jammer ou antena
arrancada — fica visualmente idêntico a um saudável.

Nosso card colore o par, via função pura `assessComms(lastConnection, lastFixTime)`:

| Estado | Regra | Cor |
|---|---|---|
| `OK` | GPS com menos de 2h | neutro |
| `GPS_CONGELADO` | GPRS < 2h **e** GPS ≥ 6h | GPS em âmbar |
| `MUDO` | GPRS ≥ 24h | ambos em vermelho |

Isso respeita a regra permanente do projeto: `position.fixTime` prova onde o veículo
estava; `device.lastConnection` só prova que o chip respirou. Misturar os dois
esconde roubo em andamento.

## Arquitetura

### Banco — migration aditiva em `Vehicle`

| Campo | Tipo | Para quê |
|---|---|---|
| `financialStatus` | `String?` | ADIMPLENTE / INADIMPLENTE espelhado do SGA |
| `financialStatusAt` | `DateTime?` | quando foi consultado |
| `sgaStatusLabel` | `String?` | ATIVO / CANCELADO / SUBSTITUIDO / INATIVO |
| `appAccessBlocked` | `Boolean @default(false)` | acesso do cliente ao ativo no app |

Aditiva e com default — nenhuma linha existente muda de comportamento.

### Preenchimento da situação financeira

Duas fontes, ambas por `HinovaService.lookupByPlate` (o `GET
/buscar/situacao-financeira-veiculo/{placa}`, único GET ao vivo que a integração
consegue chamar):

1. **No ato da associação** — `stock.service.ts` já tem o `lookup` em mãos ao vincular
   cliente e ativo. Gravar ali sai de graça.
2. **Cron diário** — percorre os veículos ativos e reconsulta, sequencial, com pausa
   entre chamadas e tolerância a falha por placa. Roda fora de request HTTP porque o
   SGA é lento e degrada com carga.

Não usamos o `POST /listar/veiculo` em lote: `situacao_financeira` só está confirmado
na resposta do GET por placa. Se um dia se confirmar que o lote traz o campo, o cron
troca de fonte sem mexer no resto.

### Endpoints

| Método | Rota | Para quê |
|---|---|---|
| GET | `/clients/assets` | lista paginada (`search`, `page`, `perPage`) |
| GET | `/clients/assets/summary` | dados da aba Análises |
| PATCH | `/clients/assets/:vehicleId/app-access` | bloquear/liberar acesso |
| PATCH | `/clients/assets/:vehicleId/financial-status` | override manual |
| PATCH | `/clients/assets/:vehicleId/technician` | alterar técnico da instalação |

A busca cobre nome, CPF (só dígitos), IMEI, placa, chassi, marca e modelo. Todas as
queries filtram por `tenantId`.

O item da lista carrega: veículo (placa, marca, modelo, tipo), associado (id, nome,
CPF), device (id, IMEI, modelo, `lastConnection`), `lastFixTime` da última posição
válida, técnico, situação financeira + data, `appAccessBlocked`, código e status no
SGA, `installedAt`.

`lastFixTime` sai de uma agregação `groupBy` sobre `Position` filtrando `valid: true`,
não de um N+1 por veículo.

### Frontend

`page.tsx` hoje tem 398 linhas e triplicaria. Quebra em:

```
app/(dashboard)/clientes/page.tsx        casca + abas
components/clientes/asset-list.tsx       busca, paginação, estados vazios
components/clientes/asset-card.tsx       o card
components/clientes/asset-actions-menu.tsx  menu ⋮
components/clientes/assets-analytics.tsx aba Análises
components/clientes/retirar-rastreador-dialog.tsx   extraído como está
components/clientes/senha-temporaria-dialog.tsx     extraído como está
lib/asset-comms.ts                       assessComms (pura, testada)
```

Auto-refresh a cada 30s, para o "há X segundos" não mentir.

**Menu ⋮ nosso:** Abrir no mapa · Ver/editar dados · Alterar técnico ·
Histórico de viagens · — · Alterar para Inadimplente / Marcar Em dia ·
Bloquear/Liberar acesso do cliente ao ativo · Redefinir senha do app · — ·
Retirar rastreador (destrutivo, com a confirmação que já existe).

## Testes

- `assessComms`: tabela cobrindo OK, GPS_CONGELADO, MUDO, e os casos nulos
  (nunca comunicou, sem posição).
- `clients.service.findAssets`: cada campo da busca encontra; paginação; um veículo
  de outro tenant nunca aparece.

## Riscos

- Base de produção tem poucos ativos hoje. Paginação e Análises só ganham densidade
  conforme a base cresce — o comportamento com base pequena precisa ser digno.
- O cron adiciona carga no SGA. Sequencial, com pausa, e tolerante a falha por placa.

## Links relacionados

- [[MEMORIA-21Go-Rastreamento]]
- [[2026-07-16-estoque-associar-sga-design]]
- [[2026-08-10-validar-instalacao-estoque-design]]
