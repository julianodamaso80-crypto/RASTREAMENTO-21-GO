# Guardião da coleta de TAGs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo dia às 07h00 (BRT), o droplet confere a coleta Find My e manda WhatsApp ao dono **só se algo estiver errado**.

**Architecture:** Um script Python só de biblioteca padrão, `scripts/coleta-tags/guardiao.py`. As checagens são funções puras, testadas com `unittest`. Uma camada fina colhe os fatos do servidor (logs, `docker`, `psql`, `curl`, `/proc`) e envia pela Evolution API. Roda por cron no próprio droplet, sem depender de nenhum computador ligado.

**Tech Stack:** Python 3.12 (stdlib: `unittest`, `urllib`, `subprocess`, `shutil`), cron, Evolution API v2.3.7.

**Spec:** `docs/superpowers/specs/2026-09-16-tags-rastreaveis-design.md` §3.2

## Global Constraints

- Horário: cron `0 10 * * *` (droplet em UTC = 07h00 BRT).
- **Tudo certo → nenhuma mensagem.** Pelo menos uma falha → uma única mensagem por execução.
- Envio: `POST https://evolution.sinistro21go.site/message/sendText/site4824`, header `apikey`, corpo `{"number":"5521992208062","text":…}`.
- A chave da Evolution fica só em `/root/guardiao/guardiao.env` (chmod 600). Nunca no repo, no log nem no vault.
- Limites: posição em `tag_positions` nas últimas **2 h**; último `inicio` de cada coletor há no máximo **2 h**; disco e memória **< 70%**; md5 esperado de `adi.pb` = `fc9e5a34ee2d9ae60843c4221a88e9f3`.
- Apple: POST sem conta com cliente `com.apple.akd/1.0` que responda **503** = falha (mudou de novo).
- Sem dependência fora da stdlib (o droplet não tem pytest).
- Commits em português, `tipo(escopo): descrição`, `git add` por arquivo.

---

### Task 1: Checagens puras e mensagem

**Files:**
- Create: `scripts/coleta-tags/guardiao.py`
- Test: `scripts/coleta-tags/test_guardiao.py`

**Interfaces:**
- Produces:
  - `ultimo_ciclo(log: str) -> tuple[datetime | None, str]`: horário UTC do último `] inicio` e o texto do bloco depois dele
  - `checar_coleta(log: str, agora: datetime, parado: bool) -> list[str]`
  - `checar_motor(log: str, agora: datetime, parado: bool) -> list[str]`
  - `checar_posicoes(qtd_ultimas_2h: int) -> list[str]`
  - `checar_anisette(rodando: bool, md5: str | None) -> list[str]`
  - `checar_apple(http_code: str) -> list[str]`
  - `checar_recursos(disco_pct: float, mem_pct: float) -> list[str]`
  - `montar_mensagem(falhas: list[str], agora: datetime) -> str | None`: `None` quando `falhas` está vazio

- [ ] **Step 1: Write the failing test**

`scripts/coleta-tags/test_guardiao.py`:

```python
import unittest
from datetime import datetime, timedelta

import guardiao as g

AGORA = datetime(2026, 9, 17, 10, 0, 0)  # UTC

LOG_BOM = """[2026-09-17 08:17:01] inicio — 500 chaves
chaves carregadas: 500
sessao ok: juliano.damaso@icloud.com
AVISTAMENTOS: 3700
[2026-09-17 08:17:08] fim — 3700 avistamentos lidos, 900 novos gravados
[2026-09-17 09:17:01] inicio — 500 chaves
AVISTAMENTOS: 3690
[2026-09-17 09:17:08] fim — 3690 avistamentos lidos, 850 novos gravados
"""

LOG_503 = """[2026-09-17 09:17:01] inicio — 500 chaves
sessao ok: juliano.damaso@icloud.com
ERRO no lote 1: Error response for GSA request: 503
AVISTAMENTOS: 0
[2026-09-17 09:17:03] nenhum avistamento novo neste ciclo
"""

MOTOR_BOM = """[2026-09-17 09:23:01] inicio
[2026-09-17T09:23:02.5+00:00] decifrados: 8 avistamento(s)
[2026-09-17 09:23:03] fim
"""


class UltimoCiclo(unittest.TestCase):
    def test_pega_o_ultimo_bloco(self):
        quando, bloco = g.ultimo_ciclo(LOG_BOM)
        self.assertEqual(quando, datetime(2026, 9, 17, 9, 17, 1))
        self.assertIn("3690", bloco)
        self.assertNotIn("3700", bloco)

    def test_log_sem_inicio(self):
        self.assertEqual(g.ultimo_ciclo("nada aqui"), (None, ""))


class Coleta(unittest.TestCase):
    def test_tudo_certo(self):
        self.assertEqual(g.checar_coleta(LOG_BOM, AGORA, parado=False), [])

    def test_erro_503(self):
        falhas = g.checar_coleta(LOG_503, AGORA, parado=False)
        self.assertEqual(len(falhas), 1)
        self.assertIn("503", falhas[0])

    def test_zero_avistamentos_sem_erro(self):
        log = "[2026-09-17 09:17:01] inicio — 500 chaves\nAVISTAMENTOS: 0\n"
        self.assertEqual(len(g.checar_coleta(log, AGORA, parado=False)), 1)

    def test_parado(self):
        falhas = g.checar_coleta(LOG_BOM, AGORA, parado=True)
        self.assertTrue(any("PARADO" in f for f in falhas))

    def test_ciclo_velho(self):
        velho = AGORA + timedelta(hours=2, minutes=1)
        falhas = g.checar_coleta(LOG_BOM, velho, parado=False)
        self.assertTrue(any("não roda" in f for f in falhas))

    def test_exatamente_2h_ainda_ok(self):
        limite = datetime(2026, 9, 17, 11, 17, 1)
        self.assertEqual(g.checar_coleta(LOG_BOM, limite, parado=False), [])

    def test_log_vazio(self):
        self.assertEqual(len(g.checar_coleta("", AGORA, parado=False)), 1)


class Motor(unittest.TestCase):
    def test_tudo_certo(self):
        self.assertEqual(g.checar_motor(MOTOR_BOM, AGORA, parado=False), [])

    def test_erro(self):
        log = "[2026-09-17 09:23:01] inicio\nERRO no lote 1: Error response for GSA request: 503\n"
        self.assertEqual(len(g.checar_motor(log, AGORA, parado=False)), 1)

    def test_parado(self):
        self.assertTrue(g.checar_motor(MOTOR_BOM, AGORA, parado=True))


class Demais(unittest.TestCase):
    def test_posicoes(self):
        self.assertEqual(g.checar_posicoes(10), [])
        self.assertEqual(len(g.checar_posicoes(0)), 1)

    def test_anisette(self):
        self.assertEqual(g.checar_anisette(True, g.MD5_ADI_ESPERADO), [])
        self.assertEqual(len(g.checar_anisette(False, None)), 1)
        self.assertEqual(len(g.checar_anisette(True, "outro")), 1)

    def test_apple(self):
        self.assertEqual(g.checar_apple("401"), [])
        self.assertEqual(len(g.checar_apple("503")), 1)
        self.assertEqual(len(g.checar_apple("000")), 1)

    def test_recursos(self):
        self.assertEqual(g.checar_recursos(69.9, 50), [])
        self.assertEqual(len(g.checar_recursos(70.0, 50)), 1)
        self.assertEqual(len(g.checar_recursos(10, 71)), 1)


class Mensagem(unittest.TestCase):
    def test_sem_falha_nao_manda(self):
        self.assertIsNone(g.montar_mensagem([], AGORA))

    def test_com_falha(self):
        texto = g.montar_mensagem(["a", "b"], AGORA)
        self.assertIn("07:00", texto)  # horário de Brasília
        self.assertIn("• a", texto)
        self.assertIn("• b", texto)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/coleta-tags && python -m unittest test_guardiao -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'guardiao'`

- [ ] **Step 3: Write minimal implementation**

`scripts/coleta-tags/guardiao.py` (parte pura; a Task 2 acrescenta a coleta de fatos e o envio):

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/coleta-tags && python -m unittest test_guardiao -v`
Expected: PASS, 18 tests OK

- [ ] **Step 5: Commit**

```bash
git add scripts/coleta-tags/guardiao.py scripts/coleta-tags/test_guardiao.py
git commit -m "feat(guardiao): checagens diárias da coleta de TAGs"
```

---

### Task 2: Coleta de fatos, envio e `--dry-run`

**Files:**
- Modify: `scripts/coleta-tags/guardiao.py` (acrescentar ao final)
- Modify: `scripts/coleta-tags/test_guardiao.py` (acrescentar classe)

**Interfaces:**
- Consumes: todas as funções `checar_*` e `montar_mensagem` da Task 1
- Produces:
  - `avaliar(fatos: dict, agora: datetime) -> list[str]`, com as chaves de `fatos`: `log_coleta, parado_coleta, log_motor, parado_motor, posicoes_2h, anisette_rodando, anisette_md5, apple_http, disco_pct, mem_pct`
  - `main(argv) -> int`: `--dry-run` imprime a mensagem sem enviar; `--forcar-teste` injeta a falha `"[TESTE] envio do guardião"`

- [ ] **Step 1: Write the failing test** (acrescentar em `test_guardiao.py`, antes do `if __name__`)

```python
class Avaliar(unittest.TestCase):
    FATOS_OK = dict(
        log_coleta=LOG_BOM, parado_coleta=False,
        log_motor=MOTOR_BOM, parado_motor=False,
        posicoes_2h=500, anisette_rodando=True,
        anisette_md5=g.MD5_ADI_ESPERADO, apple_http="401",
        disco_pct=51.0, mem_pct=46.0,
    )

    def test_tudo_certo_sem_falha(self):
        self.assertEqual(g.avaliar(self.FATOS_OK, AGORA), [])

    def test_junta_falhas_de_fontes_diferentes(self):
        fatos = dict(self.FATOS_OK, apple_http="503", disco_pct=80.0, log_coleta=LOG_503)
        self.assertEqual(len(g.avaliar(fatos, AGORA)), 3)

    def test_fato_que_nao_pode_ser_lido_vira_falha(self):
        fatos = dict(self.FATOS_OK, posicoes_2h=None)
        falhas = g.avaliar(fatos, AGORA)
        self.assertTrue(any("não consegui ler" in f for f in falhas))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/coleta-tags && python -m unittest test_guardiao -v`
Expected: FAIL with `AttributeError: module 'guardiao' has no attribute 'avaliar'`

- [ ] **Step 3: Write minimal implementation** (acrescentar ao final de `guardiao.py`)

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/coleta-tags && python -m unittest test_guardiao -v`
Expected: PASS, 21 tests OK

- [ ] **Step 5: Commit**

```bash
git add scripts/coleta-tags/guardiao.py scripts/coleta-tags/test_guardiao.py
git commit -m "feat(guardiao): colhe fatos no droplet e avisa pelo WhatsApp só em falha"
```

---

### Task 3: Instalar no droplet e provar os dois caminhos

**Files:**
- Modify: `scripts/coleta-tags/rodar.sh:23` → `IMAGEM=localhost:5000/r21go-ktag-worker:findmy-0.10.2` (espelha o que já está em produção)
- Servidor: `/root/guardiao/guardiao.py`, `/root/guardiao/guardiao.env`, crontab

**Interfaces:**
- Consumes: `guardiao.py` completo (Task 2)

- [ ] **Step 1: Copiar o script e criar o env (chave nunca no repo)**

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 'mkdir -p /root/guardiao && chmod 700 /root/guardiao'
scp -i ~/.ssh/claude_21go scripts/coleta-tags/guardiao.py root@167.71.31.77:/root/guardiao/guardiao.py
ssh -i ~/.ssh/claude_21go root@167.71.31.77 'umask 077; cat > /root/guardiao/guardiao.env <<EOF
EVOLUTION_URL=https://evolution.sinistro21go.site
EVOLUTION_INSTANCIA=site4824
EVOLUTION_APIKEY=<chave da instância site4824, tela do Evolution Manager>
AVISAR_NUMERO=5521992208062
EOF
stat -c "%a %n" /root/guardiao/guardiao.env'
```
Expected: `600 /root/guardiao/guardiao.env`

- [ ] **Step 2: Rodar os testes no próprio droplet**

Copie `test_guardiao.py` e rode no droplet:
```bash
scp -i ~/.ssh/claude_21go scripts/coleta-tags/test_guardiao.py root@167.71.31.77:/root/guardiao/
ssh -i ~/.ssh/claude_21go root@167.71.31.77 'cd /root/guardiao && python3 -m unittest test_guardiao 2>&1 | tail -3'
```
Expected: `OK`

- [ ] **Step 3: Caminho "tudo certo" — nada é enviado**

Run: `ssh … 'python3 /root/guardiao/guardiao.py --dry-run'`
Expected: `tudo certo — nenhuma mensagem`. Se listar falha, investigar a falha real antes de seguir (não ajustar limite para passar).

- [ ] **Step 4: Caminho "falha" — a mensagem chega de verdade**

Run: `ssh … 'python3 /root/guardiao/guardiao.py --forcar-teste; echo exit=$?; tail -1 /var/log/guardiao-tags.log'`
Expected: `exit=0` e `1 falha(s) — WhatsApp enviado (HTTP 201)`. Confirmar com o dono que a mensagem `[TESTE]` chegou no 21 99220-8062.

- [ ] **Step 5: Agendar e commitar**

```bash
ssh -i ~/.ssh/claude_21go root@167.71.31.77 'crontab -l > /root/crontab-backup-guardiao.txt; (crontab -l; echo "0 10 * * * /usr/bin/flock -n /tmp/guardiao-tags.lock /usr/bin/python3 /root/guardiao/guardiao.py # guardiao-tags") | crontab -; crontab -l | grep guardiao'
git add scripts/coleta-tags/rodar.sh
git commit -m "chore(coleta-tags): imagem com findmy 0.10.2 no rodar.sh"
```
Expected: linha do cron `0 10 * * * … # guardiao-tags`

- [ ] **Step 6: Registrar na memória e no vault**

Nova memória `reference_guardiao_coleta_tags.md` (o que confere, onde mora, cron 10:00 UTC, env 600, número de aviso) + ponteiro em `MEMORY.md`; SessionLog do dia no vault.
