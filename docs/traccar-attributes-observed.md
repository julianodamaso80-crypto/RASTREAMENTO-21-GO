# Atributos observados nos rastreadores em produção

> **Pendente de execução em produção.** Rodar `scripts/diagnostics/collect-traccar-attributes.ts` na droplet ou via tunnel SSH pra preencher este documento com dados reais.

## Como gerar

```bash
# Da droplet (mais simples):
ssh root@trackgo.site
cd /opt/21go && \
  TRACCAR_URL=http://traccar:8082 \
  TRACCAR_USER=<admin-traccar> \
  TRACCAR_PASS=<senha-traccar> \
  npx ts-node scripts/diagnostics/collect-traccar-attributes.ts

# Ou local com tunnel:
ssh -L 8082:traccar:8082 root@trackgo.site
# em outra aba:
TRACCAR_URL=http://localhost:8082 \
  TRACCAR_USER=<admin> TRACCAR_PASS=<senha> \
  npx ts-node scripts/diagnostics/collect-traccar-attributes.ts
```

## O que esperar (baseline teórico por protocolo)

Esta tabela vem da documentação Traccar 6.5 + manuais dos chipsets. **Não substitui a coleta real** — firmwares variam.

### GT06 / J16 (Concox)

| Atributo | Crítico pra | Notas |
|---|---|---|
| `ignition` | IGNITION_ON/OFF | Booleano, padrão |
| `batteryLevel` | BATTERY_LOW (rastreador) | 0–100 |
| `power` | VEHICLE_BATTERY_LOW | Volts (ex: 12.4) |
| `charging` | Diagnóstico | Booleano |
| `rpm` | Telemetria | Inteiro |
| `fuel` | FUEL_THEFT | % ou litros, depende do sensor |
| `temperature` | ENGINE_OVERHEATING | Celsius |
| `odometer` | Manutenção | km acumulado |
| `hours` / `engineHours` | Manutenção | horas |
| `powerCut` | POWER_CUT (sabotagem) | **Crítico antifurto** |
| `jamming` | JAMMING (interferência) | **Crítico antifurto** |
| `vibration` | Antifurto | Booleano |
| `jarring` / `collision` | COLLISION | Choque |
| `sos` | SOS | Botão de pânico |
| `door` | Segurança | Sensor de porta |
| `gsmSignal` / `rssi` | Diagnóstico | dBm ou barras |
| `sat` / `satellites` | Qualidade GPS | Inteiro |

### Suntech (ST310U/340/350)

Atributos similares ao GT06. Particularidades:
- Reporta tensão em `power` (volts).
- `alarm` traz string com código (`emergency`, `panic`, `low_battery`...).

### Teltonika (FMB920/120)

Reporta IO codes (`io1`–`io240`) genéricos. Tradução depende da configuração do device — Traccar tem mapeamento padrão. Atributos comuns:
- `pdop`, `hdop` (qualidade GPS)
- `priority` (0 = low, 1 = high, 2 = panic)
- `ev` (event ID gerado pelo device)

### GPS103 (Coban TK103/303)

Protocolo mais antigo. Geralmente só `ignition`, `power`, `gsmSignal`. Sem RPM/fuel em firmware comum.

### Sinotrack H02

Bem básico: `ignition`, `power`, `gsmSignal`, `alarm` (códigos numéricos).

## Como usar este documento

1. Após rodar a coleta, comparar a tabela real com a interface `TraccarPositionAttributes` em [traccar.service.ts](../backend/src/modules/traccar/traccar.service.ts).
2. **Atributos com count alto e ainda não tipados** → adicionar à interface.
3. **Atributos críticos ausentes** (powerCut, jamming) → revisar configuração Traccar do modelo + verificar firmware do rastreador em campo.
4. Atualizar [docs/CONVENTIONS.md](CONVENTIONS.md) com a tabela definitiva.

## Decisões já tomadas (sem precisar de coleta)

- **Persistir tudo que vier em `attributes`** em `Position.rawAttributes` (Jsonb). Garante zero perda mesmo de atributo exótico.
- **Tipar só o que tem uso direto** (alerta, telemetria, KPI). Resto fica no Jsonb.
- **Logar atributo desconhecido** em nível `debug` no Pino, agrupado por modelo, pra evolução incremental do dicionário.
