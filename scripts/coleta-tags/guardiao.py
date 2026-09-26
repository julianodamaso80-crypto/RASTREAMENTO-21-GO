"""
Guardião da coleta de TAGs na rede Find My.

Roda uma vez por dia no droplet (cron 10:00 UTC = 07:00 BRT). Se tudo estiver
certo, termina calado. Se algo falhou, manda UM WhatsApp ao dono com a lista.

Nasceu depois de 11/09/2026: a coleta ficou 5 dias sem posição (Apple passou a
recusar o cliente "Xcode" e o reboot trocou a identidade do anisette) e
ninguém ficou sabendo.
"""
import re
from datetime import datetime, timedelta

MD5_ADI_ESPERADO = "fc9e5a34ee2d9ae60843c4221a88e9f3"
LIMITE_CICLO = timedelta(hours=2)
LIMITE_RECURSO_PCT = 70.0

_INICIO = re.compile(r"^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] inicio", re.M)


def ultimo_ciclo(log):
    achados = list(_INICIO.finditer(log))
    if not achados:
        return None, ""
    ultimo = achados[-1]
    quando = datetime.strptime(ultimo.group(1), "%Y-%m-%d %H:%M:%S")
    return quando, log[ultimo.start():]


def _checar_ciclo(nome, log, agora, parado, exige_avistamento):
    falhas = []
    if parado:
        falhas.append(f"{nome}: PARADO (sessão da Apple recusada). Precisa login novo com o código do iPhone.")
    quando, bloco = ultimo_ciclo(log)
    if quando is None:
        falhas.append(f"{nome}: nenhum ciclo encontrado no log.")
        return falhas
    if agora - quando > LIMITE_CICLO:
        falhas.append(f"{nome}: não roda desde {quando:%d/%m %H:%M} UTC.")
    erro = next((l for l in bloco.splitlines() if "ERRO" in l), None)
    if erro:
        falhas.append(f"{nome}: último ciclo com erro — {erro.strip()[:160]}")
    elif exige_avistamento and re.search(r"^AVISTAMENTOS: 0$", bloco, re.M):
        falhas.append(f"{nome}: último ciclo sem nenhum avistamento.")
    return falhas


def checar_coleta(log, agora, parado):
    return _checar_ciclo("Coleta 21 GO", log, agora, parado, exige_avistamento=True)


def checar_motor(log, agora, parado):
    return _checar_ciclo("Motor MonitoraBem", log, agora, parado, exige_avistamento=False)


def checar_posicoes(qtd_ultimas_2h):
    if qtd_ultimas_2h > 0:
        return []
    return ["Banco: nenhuma posição de TAG gravada nas últimas 2 horas."]


def checar_anisette(rodando, md5):
    if not rodando:
        return ["Anisette fora do ar (container parado)."]
    if md5 != MD5_ADI_ESPERADO:
        return ["Anisette com identidade de máquina DIFERENTE — a Apple vai derrubar a sessão."]
    return []


def checar_apple(http_code):
    if http_code == "503":
        return ["Apple voltou a recusar o cliente (503 no GSA) — mudou de novo, ver FindMy.py."]
    if http_code in ("000", ""):
        return ["Apple: servidor de login inalcançável a partir do droplet."]
    return []


def checar_recursos(disco_pct, mem_pct):
    falhas = []
    if disco_pct >= LIMITE_RECURSO_PCT:
        falhas.append(f"DigitalOcean: disco em {disco_pct:.0f}% (limite 70%).")
    if mem_pct >= LIMITE_RECURSO_PCT:
        falhas.append(f"DigitalOcean: memória em {mem_pct:.0f}% (limite 70%).")
    return falhas


def montar_mensagem(falhas, agora):
    if not falhas:
        return None
    brt = agora - timedelta(hours=3)
    linhas = "\n".join(f"• {f}" for f in falhas)
    return (
        f"⚠️ Guardião das TAGs — {brt:%d/%m %H:%M}\n\n"
        f"{linhas}\n\n"
        "Localização das TAGs pode estar parada. Abra o Claude Code no projeto do rastreamento."
    )


import json
import os
import shutil
import subprocess
import sys
import urllib.request
from datetime import timezone

ENV = "/root/guardiao/guardiao.env"
LOG_COLETA = "/var/log/coleta-tags.log"
LOG_MOTOR = "/var/log/monitorabem-motor.log"
PARADO_COLETA = "/root/findmy-sessao/PARADO"
PARADO_MOTOR = "/root/monitorabem-motor/PARADO"
LOG_GUARDIAO = "/var/log/guardiao-tags.log"


def avaliar(fatos, agora):
    falhas = []
    ilegiveis = [k for k, v in fatos.items() if v is None]
    for k in ilegiveis:
        falhas.append(f"Guardião: não consegui ler '{k}' no servidor.")
    f = fatos
    if f["log_coleta"] is not None:
        falhas += checar_coleta(f["log_coleta"], agora, bool(f["parado_coleta"]))
    if f["log_motor"] is not None:
        falhas += checar_motor(f["log_motor"], agora, bool(f["parado_motor"]))
    if f["posicoes_2h"] is not None:
        falhas += checar_posicoes(f["posicoes_2h"])
    if f["anisette_rodando"] is not None:
        falhas += checar_anisette(f["anisette_rodando"], f["anisette_md5"])
    if f["apple_http"] is not None:
        falhas += checar_apple(f["apple_http"])
    if f["disco_pct"] is not None and f["mem_pct"] is not None:
        falhas += checar_recursos(f["disco_pct"], f["mem_pct"])
    return falhas


def _cmd(args, timeout=60):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:200])
    return r.stdout.strip()


def _tentar(fn):
    try:
        return fn()
    except Exception:
        return None


def _cauda(caminho, n=20000):
    with open(caminho, "rb") as fh:
        fh.seek(0, os.SEEK_END)
        fh.seek(max(0, fh.tell() - n))
        return fh.read().decode("utf-8", "replace")


def _posicoes_2h():
    cid = _cmd(["docker", "ps", "-q", "-f", "name=rastreamento-21-go_postgres-rastreamento"]).split()[0]
    sql = "select count(*) from tag_positions where received_at > now() - interval '2 hours'"
    return int(_cmd(["docker", "exec", cid, "psql", "-U", "postgres", "-d", "rastreamento21go", "-t", "-A", "-c", sql]))


def _anisette_md5():
    return _cmd(["docker", "exec", "anisette", "md5sum", "/home/Alcoholic/.config/anisette-v3/adi.pb"]).split()[0]


def _apple_http():
    cliente = "<MacBookPro13,2> <macOS;13.1;22C65> <com.apple.AuthKit/1 (com.apple.akd/1.0)>"
    return _cmd(["curl", "-k", "-s", "-m", "20", "-o", "/dev/null", "-w", "%{http_code}", "-X", "POST",
                 "--data-binary", "t", "-H", f"X-MMe-Client-Info: {cliente}",
                 "https://gsa.apple.com/grandslam/GsService2"])


def _mem_pct():
    info = {}
    for linha in open("/proc/meminfo"):
        chave, valor = linha.split(":")
        info[chave] = int(valor.split()[0])
    return 100.0 * (info["MemTotal"] - info["MemAvailable"]) / info["MemTotal"]


def colher_fatos():
    uso = shutil.disk_usage("/")
    return dict(
        log_coleta=_tentar(lambda: _cauda(LOG_COLETA)),
        parado_coleta=os.path.exists(PARADO_COLETA),
        log_motor=_tentar(lambda: _cauda(LOG_MOTOR)),
        parado_motor=os.path.exists(PARADO_MOTOR),
        posicoes_2h=_tentar(_posicoes_2h),
        anisette_rodando=_tentar(lambda: _cmd(["docker", "inspect", "-f", "{{.State.Running}}", "anisette"]) == "true"),
        anisette_md5=_tentar(_anisette_md5),
        apple_http=_tentar(_apple_http),
        disco_pct=100.0 * uso.used / uso.total,
        mem_pct=_tentar(_mem_pct),
    )


def _ler_env():
    env = {}
    for linha in open(ENV, encoding="utf-8"):
        if "=" in linha and not linha.startswith("#"):
            k, v = linha.strip().split("=", 1)
            env[k] = v
    return env


def enviar(texto):
    env = _ler_env()
    url = f"{env['EVOLUTION_URL']}/message/sendText/{env['EVOLUTION_INSTANCIA']}"
    corpo = json.dumps({"number": env["AVISAR_NUMERO"], "text": texto}).encode()
    req = urllib.request.Request(url, data=corpo, method="POST",
                                 headers={"Content-Type": "application/json", "apikey": env["EVOLUTION_APIKEY"]})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status


def _registrar(msg):
    with open(LOG_GUARDIAO, "a", encoding="utf-8") as fh:
        fh.write(f"[{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S}] {msg}\n")


def main(argv):
    agora = datetime.now(timezone.utc).replace(tzinfo=None)
    fatos = colher_fatos()
    falhas = avaliar(fatos, agora)
    if "--forcar-teste" in argv:
        falhas.append("[TESTE] envio do guardião")
    texto = montar_mensagem(falhas, agora)
    if texto is None:
        _registrar("tudo certo — nenhuma mensagem")
        print("tudo certo — nenhuma mensagem")
        return 0
    if "--dry-run" in argv:
        print(texto)
        return 0
    try:
        status = enviar(texto)
        _registrar(f"{len(falhas)} falha(s) — WhatsApp enviado (HTTP {status})")
        return 0
    except Exception as erro:
        _registrar(f"{len(falhas)} falha(s) — ENVIO FALHOU: {erro}")
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
