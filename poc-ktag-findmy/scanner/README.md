# Scanner BLE — bridge K-Tag → backend 21 GO

Detecta TAGs Apple Find My (K-Tag/RedTag/AirTag) via Bluetooth do PC e
posta cada detecção no endpoint `/api/v1/ble-tags/sightings` do backend.

**Sem Apple ID, sem SMS, sem Macless Haystack, sem internet pra Apple.**

## Setup (primeira vez)

### 1. Pré-requisitos

- Python 3.9+ no Windows
- Bluetooth do PC habilitado
- TAG cadastrada como `Device` no banco com `model = BLE_KTAG` (ou BLE_REDTAG/BLE_AIRTAG_GENERIC)
- Backend rodando em `http://localhost:3001` (ou a URL que você for usar)

### 2. Instalar dependências

```powershell
cd "c:\Users\damas\Documents\PROJETOS\21 GO\21 - RASTREAMENTO\poc-ktag-findmy\scanner"
pip install -r requirements.txt
```

### 3. Cadastrar a TAG no banco (uma vez só, via Swagger)

Acessa http://localhost:3001/api/docs

1. **Faz login** (`POST /api/v1/auth/login`):
   ```json
   { "email": "admin@rastreamento21go.com.br", "password": "admin123" }
   ```
   Copia o `token` da resposta — esse é o JWT que vai usar.

2. **Clica em "Authorize"** no topo do Swagger e cola: `Bearer <token>`

3. **Cadastra a TAG** (`POST /api/v1/devices`):
   ```json
   {
     "imei": "92603008494",
     "model": "BLE_KTAG",
     "brand": "TrackerKing",
     "notes": "TAG física do escritório, MAC inicial 0E:02:3C:02:25:EB"
   }
   ```

   O backend NÃO vai criar essa TAG no Traccar (TAG BLE não usa GPS). Só
   grava no banco como Device tipo BLE.

### 4. Configurar `.env` do scanner

```powershell
copy .env.example .env
notepad .env
```

Preenche:
- `JWT_TOKEN` = o token do passo 3.1
- `SCANNER_LAT` / `SCANNER_LNG` = onde o PC está fisicamente (sua casa/escritório)
- `SCANNER_SOURCE` = qualquer rótulo (ex: `pc-juliano`, `office-sp`)

### 5. Rodar

```powershell
python scan_ble.py
```

## Saída esperada

Quando a TAG for detectada e postada com sucesso:

```
[15:30:01] ✓ KTAG 92603008494 NPHRML | RSSI: -52 dBm | counter: 7a | OK (HTTP 201)
```

Quando bate o throttle (não passou ainda os 30s desde o último post):

```
[15:30:08] · KTAG 92603008494 NPHRML | RSSI: -50 dBm | counter: 7b | throttle (22s pra próxima)
```

Quando dá erro de rede ou auth:

```
[15:30:08] · KTAG 92603008494 NPHRML | RSSI: -50 dBm | counter: 7b | HTTP 401: ...
```

## Configurações úteis

No `.env`:

| Variável | Default | O que faz |
|---|---|---|
| `MIN_INTERVAL_SECONDS` | `30` | Mínimo de segundos entre posts da mesma TAG |
| `SCAN_DURATION_SECONDS` | `0` | `0` = roda indefinidamente, `>0` = para depois de N segundos |
| `SCANNER_SOURCE` | `scanner-anonimo` | Aparece em cada sighting no histórico |

## Limitações conhecidas

- **Range BLE ~10m** — TAG fora desse raio não é detectada
- **TAG só transmite quando "Disconnected"** — afasta o iPhone owner ~30m
- **`SCANNER_LAT/LNG` é estático** — TODO: integrar geolocalização do PC ou aceitar atualização via API
- **Não derivamos a posição real GPS da TAG** — pra isso precisaria da rede Find My da Apple. Aqui só sabemos "TAG está perto deste scanner"

## Solução de problemas

**`ERROR: JWT_TOKEN vazio`** → não preencheu o `.env`. Veja passo 4.

**`HTTP 401: Unauthorized`** → JWT expirou. Faz login de novo no Swagger e atualiza `.env`.

**`HTTP 404: TAG BLE não encontrada`** → não cadastrou a TAG como Device, ou cadastrou em outro tenant. Veja passo 3.

**`HTTP 400: Device informado não é uma TAG BLE`** → o Device existe mas com modelo errado. Cadastre com `model: "BLE_KTAG"`.

**`erro de rede: ConnectError`** → backend não tá rodando ou `API_BASE_URL` errado no `.env`.

**Nenhum log "FindMy detectado"** → a TAG está perto do iPhone que registrou ela. Afasta o iPhone uns 30m e espera 30s.
