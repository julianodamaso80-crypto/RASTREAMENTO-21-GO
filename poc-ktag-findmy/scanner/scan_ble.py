"""
Scanner BLE Apple Find My — detecta K-Tag/RedTag/AirTag e posta no backend 21 GO.

Roda 100% local, sem Apple ID, sem SMS, sem internet pra Apple.
Usa só o Bluetooth do PC pra capturar os pacotes que a TAG emite a cada 2s.

Uso:
    pip install -r requirements.txt
    cp .env.example .env  # edita com seu JWT e coordenadas
    python scan_ble.py

A TAG precisa estar separada de qualquer iPhone "owner" pra começar a transmitir
(ela só emite no estado "Disconnected"). Se tiver iPhone com Apple ID dela logada
por perto, ela fica em "Connected" e não emite.
"""
import asyncio
import hashlib
import json
import os
import sys
import time
from base64 import b64encode
from datetime import datetime
from pathlib import Path

try:
    from bleak import BleakScanner
except ImportError:
    print("ERRO: biblioteca 'bleak' não instalada.")
    print("Roda primeiro: pip install -r requirements.txt")
    sys.exit(1)

try:
    import httpx
    from dotenv import load_dotenv
except ImportError:
    print("ERRO: bibliotecas 'httpx' e/ou 'python-dotenv' não instaladas.")
    print("Roda primeiro: pip install -r requirements.txt")
    sys.exit(1)


load_dotenv(Path(__file__).parent / ".env")

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:3001").rstrip("/")
JWT_TOKEN = os.getenv("JWT_TOKEN", "").strip()
SCANNER_LAT = float(os.getenv("SCANNER_LAT", "0") or 0)
SCANNER_LNG = float(os.getenv("SCANNER_LNG", "0") or 0)
SCANNER_SOURCE = os.getenv("SCANNER_SOURCE", "scanner-anonimo")
MIN_INTERVAL_SECONDS = int(os.getenv("MIN_INTERVAL_SECONDS", "30") or 30)
SCAN_DURATION_SECONDS = int(os.getenv("SCAN_DURATION_SECONDS", "0") or 0)

APPLE_COMPANY_ID = 0x004C
FINDMY_PAYLOAD_TYPE = 0x12
KEYS_DIR = Path(__file__).parent.parent / "keys"
SIGHTING_ENDPOINT = f"{API_BASE_URL}/api/v1/ble-tags/sightings"


def reverse_mac(mac: str) -> str:
    """`0E:02:3C:02:25:EB` -> `EB:25:02:3C:02:0E` (Bluetooth little-endian)."""
    parts = mac.upper().split(":")
    return ":".join(reversed(parts))


def load_known_tags():
    """Lê todos os JSONs de chaves em ../keys/ e indexa por MAC (normal e reverso)."""
    by_mac = {}
    if not KEYS_DIR.exists():
        return by_mac
    for json_file in KEYS_DIR.glob("*.json"):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            mac = data.get("macAddress", "").upper()
            entry = {
                "name": data.get("name", json_file.stem),
                "id": data.get("id"),  # vira deviceImei na API
                "mac": mac,
                "hashedAdvKey": data.get("hashedAdvKey"),
                "file": json_file.name,
            }
            if mac:
                by_mac[mac] = entry
                by_mac[reverse_mac(mac)] = entry
        except Exception as e:
            print(f"  ! Falhou lendo {json_file.name}: {e}")
    return by_mac


def reconstruct_public_key(mac_address: str, payload: bytes) -> bytes:
    """Reconstrói chave EC P-224 (28 bytes) a partir do MAC + payload BLE."""
    if len(payload) < 27:
        return b""
    mac_bytes = bytes.fromhex(mac_address.replace(":", ""))
    msb_bits = payload[26] & 0b11
    first_byte = (mac_bytes[0] & 0b00111111) | (msb_bits << 6)
    return bytes([first_byte]) + mac_bytes[1:6] + payload[3:26]


def hash_advertisement_key_b64(pubkey: bytes) -> str:
    """SHA-256 da advertisement key, base64."""
    return b64encode(hashlib.sha256(pubkey).digest()).decode("ascii")


class SightingPoster:
    """Posta sightings no backend 21 GO com throttle por device."""

    def __init__(self, base_url: str, token: str):
        self.endpoint = f"{base_url}/api/v1/ble-tags/sightings"
        self.token = token
        self.last_post: dict[str, float] = {}  # deviceImei -> timestamp
        self.client = httpx.AsyncClient(
            timeout=10.0,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )

    async def post(self, device_imei: str, mac: str, rssi: int, hashed_adv_key: str | None, counter_byte: int) -> tuple[bool, str]:
        """Returns (success, message). Aplica throttle por device_imei."""
        now = time.monotonic()
        last = self.last_post.get(device_imei, 0)
        if now - last < MIN_INTERVAL_SECONDS:
            return False, f"throttle ({MIN_INTERVAL_SECONDS - int(now - last)}s pra próxima)"

        body = {
            "deviceImei": device_imei,
            "macAddress": mac,
            "rssi": rssi,
            "counterByte": counter_byte,
            "scannerLat": SCANNER_LAT or None,
            "scannerLng": SCANNER_LNG or None,
            "scannerSource": SCANNER_SOURCE,
        }
        if hashed_adv_key:
            body["hashedAdvKey"] = hashed_adv_key

        for attempt in range(3):
            try:
                resp = await self.client.post(self.endpoint, json=body)
                if resp.status_code == 201 or resp.status_code == 200:
                    self.last_post[device_imei] = now
                    return True, f"OK (HTTP {resp.status_code})"
                # Não-2xx: log e retry só em 5xx
                if 500 <= resp.status_code < 600 and attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                    continue
                return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.HTTPError) as e:
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                    continue
                return False, f"erro de rede: {type(e).__name__}: {e}"
        return False, "esgotaram retries"

    async def close(self):
        await self.client.aclose()


def validate_config():
    errors = []
    if not JWT_TOKEN:
        errors.append("JWT_TOKEN vazio no .env — gera via POST /api/v1/auth/login")
    if SCANNER_LAT == 0 and SCANNER_LNG == 0:
        print("  ! SCANNER_LAT/LNG = 0,0 (escolhe um lugar real no .env)")
    if not (KEYS_DIR.exists() and any(KEYS_DIR.glob("*.json"))):
        errors.append(f"Nenhum JSON de chave em {KEYS_DIR}")
    return errors


async def main():
    print("=" * 70)
    print("  SCANNER BLE — Apple Find My (K-Tag / AirTag / RedTag)")
    print("  Modo: BRIDGE (posta cada detecção no backend 21 GO)")
    print("=" * 70)

    errors = validate_config()
    if errors:
        print("\n  CONFIG INVÁLIDA:")
        for e in errors:
            print(f"    - {e}")
        print(f"\n  Edita o arquivo: {Path(__file__).parent / '.env'}")
        print(f"  Modelo: {Path(__file__).parent / '.env.example'}")
        sys.exit(1)

    print(f"\n  API: {API_BASE_URL}")
    print(f"  Scanner: {SCANNER_SOURCE} ({SCANNER_LAT}, {SCANNER_LNG})")
    print(f"  Throttle: 1 post a cada {MIN_INTERVAL_SECONDS}s por TAG")

    known = load_known_tags()
    unique_tags = {tag["file"]: tag for tag in known.values()}
    print(f"\n  Chaves carregadas: {len(unique_tags)}")
    for tag in unique_tags.values():
        print(f"    - {tag['name']} (id {tag['id']}, MAC {tag['mac']})")

    duration_label = (
        f"{SCAN_DURATION_SECONDS}s" if SCAN_DURATION_SECONDS > 0 else "indefinidamente (Ctrl+C pra parar)"
    )
    print(f"\n  Escaneando por {duration_label}...\n")
    print("-" * 70)

    poster = SightingPoster(API_BASE_URL, JWT_TOKEN)
    seen_macs: dict[str, float] = {}

    async def handle_detection(device, advertisement_data):
        manufacturer_data = advertisement_data.manufacturer_data
        if APPLE_COMPANY_ID not in manufacturer_data:
            return
        payload = manufacturer_data[APPLE_COMPANY_ID]
        if len(payload) < 2 or payload[0] != FINDMY_PAYLOAD_TYPE:
            return

        mac = device.address.upper()
        rssi = advertisement_data.rssi

        # Anti-spam visual: log mesma MAC só a cada 5s
        now = asyncio.get_event_loop().time()
        last = seen_macs.get(mac, 0)
        if now - last < 5:
            return
        seen_macs[mac] = now

        match = known.get(mac)
        ts = datetime.now().strftime("%H:%M:%S")
        counter = payload[-1]

        if not match:
            # TAG desconhecida — só logga, não posta
            return

        try:
            pubkey = reconstruct_public_key(mac, payload)
            adv_hash = hash_advertisement_key_b64(pubkey) if pubkey else None
        except Exception:
            adv_hash = None

        ok, msg = await poster.post(
            device_imei=match["id"],
            mac=mac,
            rssi=rssi,
            hashed_adv_key=adv_hash,
            counter_byte=counter,
        )
        prefix = "[OK]" if ok else "[..]"
        print(
            f"  [{ts}] {prefix} {match['name']} | RSSI: {rssi} dBm | counter: {counter:02x} | {msg}"
        )

    def callback(device, advertisement_data):
        # bleak chama callback síncrono — agendamos a coroutine
        asyncio.create_task(handle_detection(device, advertisement_data))

    scanner = BleakScanner(detection_callback=callback)
    await scanner.start()
    try:
        if SCAN_DURATION_SECONDS > 0:
            await asyncio.sleep(SCAN_DURATION_SECONDS)
        else:
            # Roda indefinidamente até Ctrl+C
            while True:
                await asyncio.sleep(60)
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        await scanner.stop()
        await poster.close()

    print("-" * 70)
    print(f"\n  Fim do scan.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Interrompido pelo usuário.")
