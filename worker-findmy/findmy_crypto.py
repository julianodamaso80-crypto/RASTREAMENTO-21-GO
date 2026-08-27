"""
Decifragem dos relatórios da rede Find My.

O endpoint do Macless Haystack NÃO decifra nada: ele autentica na Apple, baixa
os relatórios e devolve o payload como veio, em base64. Quem consegue abrir o
envelope é só quem tem a chave privada da TAG — que é o ponto do protocolo, e
o motivo de a Apple não conseguir ler a posição dos nossos ativos.

Então a decifragem mora aqui.

O protocolo, para quem for mexer nisto depois:

  1. A TAG anuncia por Bluetooth uma chave pública efêmera que muda o tempo
     todo.
  2. Um iPhone qualquer que passe perto ouve esse anúncio, pega a PRÓPRIA
     localização, cifra com a chave da TAG e manda pra Apple.
  3. A Apple guarda por 7 dias e entrega para quem pedir pelo hash da chave —
     sem saber o que tem dentro.
  4. Com a chave privada da TAG, derivamos o segredo compartilhado (ECDH sobre
     a curva SECP224R1), tiramos dele a chave AES e abrimos o pacote.

Portado de biemster/FindMy (request_reports.py), que por sua vez veio de
hatomist/openhaystack-python. Mantido byte a byte igual ao original: qualquer
"melhoria" aqui quebra a decifragem silenciosamente e a TAG vira um ponto no
meio do oceano.
"""
import hashlib
import struct
from base64 import b64decode
from datetime import datetime, timezone

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

# A Apple conta segundos a partir de 01/01/2001, não de 1970.
EPOCH_APPLE_PARA_UNIX = 978307200


def _sha256(data: bytes) -> bytes:
    digest = hashlib.new("sha256")
    digest.update(data)
    return digest.digest()


def decode_tag(data: bytes) -> dict:
    """Os 10 bytes de dentro do envelope: onde a TAG estava e quão certo isso é."""
    latitude = struct.unpack(">i", data[0:4])[0] / 10000000.0
    longitude = struct.unpack(">i", data[4:8])[0] / 10000000.0
    confidence = int.from_bytes(data[8:9], "big")
    status = int.from_bytes(data[9:10], "big")
    return {
        "lat": latitude,
        "lon": longitude,
        "conf": confidence,
        "status": status,
    }


def decrypt_report(payload_b64: str, private_key_b64: str) -> dict:
    """
    Abre um relatório e devolve onde a TAG foi vista.

    Levanta exceção quando o pacote não abre — chave errada, payload corrompido
    ou formato mudado. Quem chama decide o que fazer; engolir a falha aqui
    faria a TAG sumir do mapa sem ninguém saber por quê.
    """
    priv = int.from_bytes(b64decode(private_key_b64), "big")
    data = b64decode(payload_b64)

    # Relatórios mais novos trazem um byte a mais no cabeçalho. O original
    # descarta exatamente o byte 4; sem isso todo o resto desalinha.
    if len(data) > 88:
        data = data[:4] + data[5:]

    timestamp = int.from_bytes(data[0:4], "big") + EPOCH_APPLE_PARA_UNIX

    chave_efemera = ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP224R1(), data[5:62]
    )
    segredo = ec.derive_private_key(
        priv, ec.SECP224R1(), default_backend()
    ).exchange(ec.ECDH(), chave_efemera)

    simetrica = _sha256(segredo + b"\x00\x00\x00\x01" + data[5:62])
    chave_aes = simetrica[:16]
    iv = simetrica[16:]
    cifrado = data[62:72]
    tag_gcm = data[72:]

    decryptor = Cipher(
        algorithms.AES(chave_aes), modes.GCM(iv, tag_gcm), default_backend()
    ).decryptor()
    aberto = decryptor.update(cifrado) + decryptor.finalize()

    resultado = decode_tag(aberto)
    resultado["timestamp"] = timestamp
    resultado["isodatetime"] = datetime.fromtimestamp(
        timestamp, tz=timezone.utc
    ).isoformat()
    return resultado
