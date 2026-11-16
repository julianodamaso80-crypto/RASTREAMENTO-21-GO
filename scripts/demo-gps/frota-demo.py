#!/usr/bin/env python3
"""
Simulador da FROTA da empresa de demonstração do painel (12 veículos DEMOTRK).

Não são clientes nem rastreadores reais: manda posição ao Traccar pelo
protocolo OsmAnd (porta 5055), como se fossem aparelhos em campo, cada um num
circuito diferente do Rio. Uns andam, uns ficam parados com a ignição
desligada e um fica sem comunicar (para a demo mostrar "offline").

Cron: * * * * * flock -n /tmp/frota-demo.lock python3 /opt/demo-gps/frota-demo.py
Desligar = tirar a linha do crontab. Nada mais depende disto.
"""
import json
import math
import random
import time
import urllib.parse
import urllib.request

OSMAND = "http://127.0.0.1:5055/"
ESTADO = "/opt/demo-gps/frota-demo-estado.json"
RODADAS = 4          # 4 envios por minuto
INTERVALO_S = 15

# Circuitos (lat, lng) em bairros diferentes.
CIRCUITOS = {
    "centro": [(-22.9035, -43.1772), (-22.9068, -43.1729), (-22.9110, -43.1760), (-22.9083, -43.1830), (-22.9040, -43.1820)],
    "tijuca": [(-22.9249, -43.2329), (-22.9215, -43.2250), (-22.9180, -43.2310), (-22.9230, -43.2400)],
    "barra": [(-23.0004, -43.3659), (-23.0060, -43.3400), (-23.0120, -43.3200), (-23.0080, -43.3500)],
    "avbrasil": [(-22.8805, -43.2465), (-22.8650, -43.2600), (-22.8500, -43.2800), (-22.8650, -43.2650)],
    "niteroi": [(-22.9068, -43.1100), (-22.9030, -43.1150), (-22.8970, -43.1230), (-22.9020, -43.1180)],
    "copacabana": [(-22.9633, -43.1680), (-22.9720, -43.1860), (-22.9790, -43.1900), (-22.9690, -43.1790)],
    "meier": [(-22.9020, -43.2790), (-22.8980, -43.2850), (-22.9050, -43.2900), (-22.9080, -43.2830)],
    "linhavermelha": [(-22.8950, -43.2200), (-22.8700, -43.2500), (-22.8400, -43.2700), (-22.8700, -43.2450)],
}

# (imei, circuito, velocidade km/h, modo)  modo: anda | parado | mudo
FROTA = [
    ("DEMOTRK00000001", "centro", 32, "anda"),
    ("DEMOTRK00000002", "tijuca", 41, "anda"),
    ("DEMOTRK00000003", "barra", 68, "anda"),
    ("DEMOTRK00000004", "avbrasil", 74, "anda"),
    ("DEMOTRK00000005", "niteroi", 0, "parado"),
    ("DEMOTRK00000006", "copacabana", 36, "anda"),
    ("DEMOTRK00000007", "meier", 0, "parado"),
    ("DEMOTRK00000008", "linhavermelha", 82, "anda"),
    ("DEMOTRK00000009", "centro", 0, "parado"),
    ("DEMOTRK00000010", "tijuca", 0, "mudo"),
    ("DEMOTRK00000011", "barra", 55, "anda"),
    ("DEMOTRK00000012", "copacabana", 28, "anda"),
]


def metros(a, b):
    r = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    x = (lo2 - lo1) * math.cos((la1 + la2) / 2)
    return math.hypot(x, la2 - la1) * r


def rumo(a, b):
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    d = math.radians(b[1] - a[1])
    y = math.sin(d) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(d)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def ponto(circuito, dist):
    pts = CIRCUITOS[circuito]
    pernas = [(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
    total = sum(metros(a, b) for a, b in pernas)
    d = dist % total
    for a, b in pernas:
        t = metros(a, b)
        if d <= t:
            f = d / t if t else 0
            return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, rumo(a, b)
        d -= t
    return pts[0][0], pts[0][1], 0.0


def ler_estado():
    try:
        with open(ESTADO) as f:
            return json.load(f)
    except Exception:
        return {}


def enviar(imei, lat, lng, vel_kmh, curso, ignicao):
    q = {
        "id": imei, "timestamp": int(time.time()), "lat": f"{lat:.6f}", "lon": f"{lng:.6f}",
        "speed": f"{vel_kmh / 1.852:.1f}",  # OsmAnd: nós
        "bearing": f"{curso:.0f}", "altitude": "12", "accuracy": "5", "hdop": "0.8",
        "sat": "11", "batt": "100", "ignition": "true" if ignicao else "false",
        "power": "12.6" if ignicao else "12.3",
    }
    url = OSMAND + "?" + urllib.parse.urlencode(q)
    urllib.request.urlopen(url, timeout=5).read()


def main():
    estado = ler_estado()
    for rodada in range(RODADAS):
        for i, (imei, circ, vel, modo) in enumerate(FROTA):
            if modo == "mudo":
                continue
            dist = float(estado.get(imei, i * 700.0))
            if modo == "anda":
                v = max(5, vel + random.uniform(-8, 8))
                dist += v * 1000 / 3600 * INTERVALO_S
                lat, lng, curso = ponto(circ, dist)
                estado[imei] = dist
                ign = True
            else:
                lat, lng, curso = ponto(circ, dist)
                v, ign = 0.0, False
            try:
                enviar(imei, lat, lng, v, curso, ign)
            except Exception as e:  # um aparelho falhando não para os outros
                print(time.strftime("%H:%M:%S"), imei, "falhou:", e)
        with open(ESTADO, "w") as f:
            json.dump(estado, f)
        if rodada < RODADAS - 1:
            time.sleep(INTERVALO_S)


if __name__ == "__main__":
    main()
