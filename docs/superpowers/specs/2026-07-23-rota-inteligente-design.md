---
data: 2026-07-23
projeto: 21 GO Rastreamento
tags: [rota, instalacao, geocoding, tecnicos, pendencias]
tipo: decisão
---

# Rota inteligente de instalação

## Contexto

A aba [Pendentes de Instalação](../../../frontend/dashboard/src/app/(dashboard)/pendencias/page.tsx)
lista ~5.900 veículos com rastreador/TAG contratado e não instalado — 97% no RJ
metropolitano, 2.879 só na capital. Hoje o técnico vai a campo sem roteiro: instala
onde dá, com deslocamento desperdiçado.

Objetivo: o operador agrupa as pendências próximas em bolsões, monta uma rota
ordenada e envia pro celular do técnico, que instala mais com raio menor.

## Decisões (validadas com o dono)

| Decisão | Escolha | Motivo |
|---|---|---|
| Quem monta a rota | Operador no painel envia pro técnico | Controle central; técnico executa |
| Como o técnico navega | Lista ordenada + botão Waze/Google Maps por parada | Ele já usa Waze; turn-by-turn nativo é melhor que reimplementar |
| Coordenadas | **AwesomeAPI** por CEP (grátis), fallback Nominatim | Testado 2026-07-23: 100% de cobertura em amostra, ~12min pra base toda, cache permanente. BrasilAPI foi descartada — não devolve coordenada |
| Ordenação | Vizinho-mais-próximo | Rápido e bom pra bolsão denso; dispensa API de rotas paga |
| Alvo por rota | ~10-12 paradas, ajustável na hora | Volume real de um técnico por dia |

## Arquitetura

### Fatia 1 — Coordenadas

`installation_pendings` ganha `cep`, `street`, `number`, `lat`, `lng` (migração
aditiva). O sync passa a puxar logradouro/número/CEP do associado (já vêm em
`POST /listar/associado/`, só não eram mapeados).

Cache `cep_coordinates` (cep PK, lat, lng, source) — endereço não muda, geocodifica
uma vez. Serviço `GeocodingService`:
1. AwesomeAPI `cep.awesomeapi.com.br/json/{cep}` → lat/lng (nível de rua).
2. Fallback Nominatim por rua+número quando a AwesomeAPI não tiver o CEP (rate
   limit 1 req/s, só pro resíduo).
No fim do sync, geocodifica os CEPs ainda sem cache e preenche `lat`/`lng` nas
pendências. CEP sem coordenada fica visível numa lista "sem localização" —
nunca some em silêncio.

### Fatia 2 — Agrupamento

`RouteClusterService`: agrupa as pendências geolocalizadas em bolsões por
proximidade (liga pontos a menos de ~2km, tipo DBSCAN). Cada bolsão: centróide,
contagem, raio em km, split rastreador/TAG, bairro predominante.
Endpoint `GET /installation-pendings/clusters?days=60`.

### Fatia 3 — Montar e enviar

Models novos:
- `InstallationRoute` (tenantId, technicianId, assignedById, date, status
  PENDING/DONE/CANCELLED, createdAt).
- `RouteStop` (routeId, installationPendingId snapshot dos dados de contato/
  endereço/lat/lng, order, status PENDING/DONE, doneAt).

Snapshot: a rota guarda cópia dos dados no envio, pra não quebrar quando o sync
reescreve `installation_pendings`.

`POST /installation-pendings/routes` `{ technicianId, pendingIds[] }` → ordena por
vizinho-mais-próximo e cria a rota. Ordenação pura e testável em
`route-ordering.ts`.

### Fatia 4 — Painel: aba "Rota Inteligente"

No sidebar, abaixo de Pendentes de Instalação (`NON_CLIENT_ROLES`). Mapa MapLibre
(já usado no projeto) com os bolsões. Operador clica num bolsão → ajusta nº de
paradas → escolhe técnico (`active && canReceiveEquipment`) → "Montar e enviar".
A rota ordenada aparece pra conferência antes do envio.

### Fatia 5 — App do técnico

Em `/tecnico`, aba "Minha rota de hoje": lista numerada na ordem de visita, cada
parada com nome, endereço, telefone (botão ligar) e botão Waze
(`https://waze.com/ul?ll={lat},{lng}&navigate=yes`, fallback Google Maps).
Endpoint `GET /tech/route`.

Fecha o ciclo: ao finalizar a instalação (fluxo existente do estoque), a parada
some da rota **e** da fila de pendências — estende o `removeByPlate` já existente
pra marcar o `RouteStop` como DONE.

## Tratamento de erro

| Situação | Resposta |
|---|---|
| CEP sem coordenada em nenhuma fonte | Pendência entra em "sem localização"; fora dos bolsões até resolver |
| AwesomeAPI/Nominatim fora do ar | Geocoding é best-effort no sync; tenta de novo no próximo; não derruba o sync |
| Técnico sem equipamento reservado | Pode receber rota mesmo assim (reserva e rota são independentes na v1) |
| Rota montada e a pendência sai no sync | Snapshot no RouteStop preserva os dados; parada continua válida |
| Placa instalada por fora da rota | `removeByPlate` marca o stop como DONE se existir |

## Testes

- Ordenação vizinho-mais-próximo: caso conhecido → ordem esperada.
- Agrupamento: pontos a <2km no mesmo bolsão; ponto isolado sozinho.
- Geocoding: cache hit não rechama a API; fallback aciona quando primária falha.
- Ciclo: instalar remove da fila e marca o stop DONE.

## Fora de escopo (v1)

Janela de horário por cliente ("às 14h"), otimização multi-técnico simultânea,
navegação turn-by-turn dentro do app (Waze faz melhor), rota que sobrevive vários
dias. Todos somáveis depois.

## Links

- [[project_pendencias_instalacao]]
- [[reference_sga_tipo_adesao]] — endereço completo vem do associado
- [2026-07-21-tecnicos-design.md](2026-07-21-tecnicos-design.md) — app do técnico reaproveitado
