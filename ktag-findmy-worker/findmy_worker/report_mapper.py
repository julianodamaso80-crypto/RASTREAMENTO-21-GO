"""
Traduz um relatório da rede Find My para o payload que o backend 21 GO aceita.

A rede Apple não informa RSSI: a posição vem do iPhone que ouviu a TAG, não da
potência do sinal. Por isso o campo simplesmente não vai no payload — inventar
um número aqui viraria dado falso na tela do operador.
"""
from datetime import timezone


def relatorio_para_payload(relatorio: dict, device_imei: str) -> dict:
    visto_em = relatorio["timestamp"]
    if visto_em.tzinfo is None:
        visto_em = visto_em.replace(tzinfo=timezone.utc)

    payload = {
        "deviceImei": device_imei,
        "macAddress": "",
        "hashedAdvKey": relatorio["hashed_adv_key"],
        "seenAt": visto_em.isoformat(),
        "scannerLat": relatorio["latitude"],
        "scannerLng": relatorio["longitude"],
        "scannerSource": "apple-findmy",
    }

    precisao = relatorio.get("horizontal_accuracy")
    if precisao is not None:
        payload["accuracy"] = int(precisao)

    return payload
