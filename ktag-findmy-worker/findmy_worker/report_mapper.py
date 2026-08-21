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
        try:
            precisao_int = int(precisao)
        except (TypeError, ValueError, OverflowError):
            # OverflowError: int(float('inf')) não é TypeError nem
            # ValueError, e sem capturar aqui ela escapava e derrubava o
            # ciclo inteiro em vez de só omitir a precisão.
            precisao_int = None
        # backend valida accuracy com @Min(0) e @Max(50000); um valor fora
        # dessa faixa rejeitaria o payload inteiro (posição e tudo) em vez
        # de só perder a precisão — melhor omitir o campo.
        if precisao_int is not None and 0 <= precisao_int <= 50000:
            payload["accuracy"] = precisao_int

    return payload
