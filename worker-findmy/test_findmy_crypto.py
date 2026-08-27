"""
Prova que a decifragem funciona, sem depender da Apple.

O teste monta um relatório do jeito que um iPhone montaria — gera a chave
efêmera, deriva o segredo, cifra a coordenada — e confere que o nosso
decifrador recupera exatamente a mesma coordenada. Se o algoritmo estiver
errado em um byte, a coordenada volta noutro lugar do mundo ou o GCM recusa a
autenticação.
"""
import hashlib
import os
import struct
from base64 import b64encode

import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
)

from findmy_crypto import EPOCH_APPLE_PARA_UNIX, decode_tag, decrypt_report


def _monta_relatorio(lat, lon, conf, status, timestamp_unix, priv_tag):
    """Faz o que o iPhone que avista a TAG faria."""
    pub_tag = priv_tag.public_key()

    efemera = ec.generate_private_key(ec.SECP224R1(), default_backend())
    ponto_efemero = efemera.public_key().public_bytes(
        Encoding.X962, PublicFormat.UncompressedPoint
    )
    assert len(ponto_efemero) == 57

    segredo = efemera.exchange(ec.ECDH(), pub_tag)
    simetrica = hashlib.sha256(
        segredo + b"\x00\x00\x00\x01" + ponto_efemero
    ).digest()

    encryptor = Cipher(
        algorithms.AES(simetrica[:16]),
        modes.GCM(simetrica[16:]),
        default_backend(),
    ).encryptor()

    claro = (
        struct.pack(">i", int(round(lat * 10000000)))
        + struct.pack(">i", int(round(lon * 10000000)))
        + bytes([conf])
        + bytes([status])
    )
    cifrado = encryptor.update(claro) + encryptor.finalize()

    carimbo = (timestamp_unix - EPOCH_APPLE_PARA_UNIX).to_bytes(4, "big")
    # byte 4 é o "status do anúncio"; o decifrador o descarta quando o pacote
    # é do formato longo.
    payload = carimbo + b"\x00" + ponto_efemero + cifrado + encryptor.tag
    return b64encode(payload).decode()


@pytest.fixture
def par_de_chaves():
    priv = ec.generate_private_key(ec.SECP224R1(), default_backend())
    bruto = priv.private_numbers().private_value.to_bytes(28, "big")
    return priv, b64encode(bruto).decode()


def test_decifra_a_coordenada_exata(par_de_chaves):
    priv_obj, priv_b64 = par_de_chaves
    # Sede da 21 GO, em Campo Grande.
    lat, lon, conf, ts = -22.9390364, -43.5600123, 42, 1787760795

    relatorio = _monta_relatorio(lat, lon, conf, 0, ts, priv_obj)
    aberto = decrypt_report(relatorio, priv_b64)

    assert aberto["lat"] == pytest.approx(lat, abs=1e-7)
    assert aberto["lon"] == pytest.approx(lon, abs=1e-7)
    assert aberto["conf"] == conf
    assert aberto["timestamp"] == ts
    assert aberto["isodatetime"].startswith("2026-")


def test_chave_errada_nao_devolve_posicao_falsa(par_de_chaves):
    """Falhar alto é o certo: posição errada no mapa é pior que posição nenhuma."""
    priv_obj, _ = par_de_chaves
    relatorio = _monta_relatorio(-22.9, -43.5, 10, 0, 1787760795, priv_obj)

    outra = ec.generate_private_key(ec.SECP224R1(), default_backend())
    outra_b64 = b64encode(
        outra.private_numbers().private_value.to_bytes(28, "big")
    ).decode()

    with pytest.raises(Exception):
        decrypt_report(relatorio, outra_b64)


def test_payload_corrompido_levanta(par_de_chaves):
    _, priv_b64 = par_de_chaves
    with pytest.raises(Exception):
        decrypt_report(b64encode(os.urandom(90)).decode(), priv_b64)


def test_decode_tag_le_coordenada_negativa():
    """Brasil inteiro é lat e lon negativas: sinal errado joga o carro na Ásia."""
    bruto = (
        struct.pack(">i", -229390364)
        + struct.pack(">i", -435600123)
        + bytes([55])
        + bytes([1])
    )
    lido = decode_tag(bruto)
    assert lido["lat"] == pytest.approx(-22.9390364)
    assert lido["lon"] == pytest.approx(-43.5600123)
    assert lido["conf"] == 55
    assert lido["status"] == 1
