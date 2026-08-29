# MonitoraBem — Motor Find My (Bloco 1) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Goal:** Um serviço Python que descobre onde cada TAG do MonitoraBem foi vista — consultando a rede Find My da Apple em lotes de 256 chaves, distribuídos por um pool de contas, sempre por proxy residencial — e entrega essas posições ao backend sem perder nenhuma quando algo cai.

**Architecture:** Módulos pequenos de lógica pura (fatiar lotes, distribuir entre contas, deduplicar, decidir janela de backfill), cada um testável sem rede e sem disco, orquestrados por um único `ciclo.py`. As duas bordas com o mundo — Apple e backend — ficam isoladas em `apple.py` e `backend.py`, e nos testes são substituídas por dublês. O motor é entregável e testável **sem que o backend exista**: o contrato HTTP está congelado neste plano e os testes usam um servidor falso.

**Tech Stack:** Python 3.11, httpx 0.27, cryptography 42+, findmy 0.10.1, pytest 8.3, Docker.

## Global Constraints

- **Repositório novo:** `C:\Users\damas\Documents\PROJETOS\MONITORABEM`. O motor vive em `motor/`. Nada é importado por dependência do 21 GO — o que vem de lá vem por cópia, com caminho de origem citado na tarefa.
- **Proxy residencial obrigatório.** A Apple devolve **lista vazia sem erro** quando a consulta parte de IP de datacenter, o que é indistinguível de "ninguém viu a TAG". O motor **recusa-se a subir** sem `APPLE_PROXY` configurado.
- **Piso de 30 minutos, aplicado no código.** `INTERVALO_S` abaixo de 1800 é ignorado e substituído por 1800. Consultar mais rápido bane a conta Apple, e a latência da própria rede (8 a 47 min) é maior que isso.
- **Lote de 256 chaves por consulta.** É o máximo que a Apple aceita por requisição.
- **A chave privada da TAG nunca é registrada em log.** Nem em `debug`, nem em mensagem de exceção.
- **Idioma:** nomes de módulo, função e variável em português, seguindo o padrão do 21 GO. Mensagens de log em português.
- **Autenticação com o backend:** header `X-Motor-Key` com chave de serviço de longa duração (`MOTOR_API_KEY`). Nunca JWT de sessão — o worker do 21 GO usa um token de 12h e fica cego quando ele vence; esse defeito não se repete aqui.
- **Todo commit roda `pytest -q` verde antes de existir.**

## Contrato HTTP com o backend (congelado)

O bloco 2 implementará o outro lado. Estes dois endpoints são a fronteira.

**`GET /interno/motor/plano`** — o que consultar agora.

```json
{
  "tags": [
    {
      "tagId": "8f14e45f-ceea-467a-9f5a-2b3c4d5e6f70",
      "hashedAdvKey": "TSHW5xxdV1nP3fJTQ0MGWo6NfKk9EMGKcnCPvSHT8Kk=",
      "privateKey": "Bm9d4Nh5oXVpQ8sJ2mKfR7cT1yU0iO3pA6sD9fG2hJ4=",
      "backfillHours": 168
    }
  ]
}
```

**`POST /interno/motor/avistamentos`** — entrega em lote.

```json
{
  "avistamentos": [
    {
      "tagId": "8f14e45f-ceea-467a-9f5a-2b3c4d5e6f70",
      "hashedAdvKey": "TSHW5xxdV1nP3fJTQ0MGWo6NfKk9EMGKcnCPvSHT8Kk=",
      "vistoEm": "2026-08-29T12:04:31+00:00",
      "lat": -22.938804,
      "lng": -43.560138,
      "precisaoM": 12
    }
  ]
}
```

Resposta `200`: `{"aceitos": 42, "duplicados": 8}`.

Entrega em lote, e não um POST por avistamento como no 21 GO: com milhares de TAGs, um POST por ponto derruba o backend antes de derrubar qualquer outra coisa.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `motor/config.py` | Lê e valida o ambiente. Recusa subir sem proxy e sem chave de serviço |
| `motor/cripto.py` | Abre o envelope cifrado da Apple (ECDH SECP224R1 + AES-GCM) |
| `motor/lotes.py` | Fatia a lista de chaves em lotes de 256 |
| `motor/contas.py` | Carrega o pool de contas Apple e distribui as chaves de forma estável |
| `motor/saude.py` | Registra sucesso e falha por conta; tira do rodízio quem está quebrada |
| `motor/apple.py` | Borda com a rede Find My. Impõe o proxy no processo |
| `motor/backend.py` | Borda com o backend. Erros tipados: permanente, transitório, credencial |
| `motor/fila.py` | Fila em disco do que ainda não foi entregue, com quarentena |
| `motor/memoria.py` | Deduplicação e controle de backfill dentro do processo |
| `motor/ciclo.py` | Um ciclo completo: plano → consulta → decifra → entrega |
| `motor/worker.py` | Laço infinito com o piso de 30 minutos |
| `tests/` | Um arquivo de teste por módulo |

---

# Task 1: Esqueleto do repositório e configuração que se recusa a subir errado

A primeira coisa que o motor faz é provar que pode funcionar. Sem proxy ele não consulta, e é melhor não subir do que subir devolvendo "ninguém viu a TAG" para uma frota inteira.

**Files:**
- Create: `motor/__init__.py`
- Create: `motor/config.py`
- Create: `requirements.txt`
- Create: `pytest.ini`
- Create: `.gitignore`
- Test: `tests/test_config.py`

**Interfaces:**
- Produces: `carregar_config(ambiente: dict) -> Config`, onde `Config` é uma dataclass com os campos `api_base: str`, `api_key: str`, `apple_proxy: str`, `anisette_url: str`, `contas_path: str`, `fila_path: str`, `intervalo_s: int`.
- Produces: `class ConfiguracaoInvalida(RuntimeError)`.
- Produces: `INTERVALO_MINIMO_S = 1800`.

- [ ] **Step 1: Criar o repositório e entrar nele**

```bash
mkdir -p "/c/Users/damas/Documents/PROJETOS/MONITORABEM"
cd "/c/Users/damas/Documents/PROJETOS/MONITORABEM"
git init
mkdir -p motor tests
```

- [ ] **Step 2: Escrever os arquivos de apoio**

`requirements.txt`:

```
httpx==0.27.2
cryptography>=42
findmy==0.10.1
pytest==8.3.3
```

`pytest.ini`:

```ini
[pytest]
testpaths = tests
python_files = test_*.py
```

`.gitignore`:

```
__pycache__/
*.pyc
.env
contas.json
fila/
data/
.venv/
```

`motor/__init__.py`: arquivo vazio.

- [ ] **Step 3: Escrever o teste que falha**

`tests/test_config.py`:

```python
import pytest

from motor.config import (
    INTERVALO_MINIMO_S,
    ConfiguracaoInvalida,
    carregar_config,
)

AMBIENTE_COMPLETO = {
    "API_BASE_URL": "https://api.monitorabem.site",
    "MOTOR_API_KEY": "chave-de-servico",
    "APPLE_PROXY": "http://usuario:senha@proxy.exemplo:8080",
    "ANISETTE_URL": "http://anisette:6969",
    "CONTAS_PATH": "/app/contas.json",
    "FILA_PATH": "/app/fila",
}


def test_carrega_ambiente_completo():
    cfg = carregar_config(AMBIENTE_COMPLETO)
    assert cfg.api_base == "https://api.monitorabem.site"
    assert cfg.api_key == "chave-de-servico"
    assert cfg.apple_proxy == "http://usuario:senha@proxy.exemplo:8080"


def test_sem_proxy_recusa_subir():
    ambiente = {k: v for k, v in AMBIENTE_COMPLETO.items() if k != "APPLE_PROXY"}
    with pytest.raises(ConfiguracaoInvalida) as erro:
        carregar_config(ambiente)
    assert "APPLE_PROXY" in str(erro.value)


def test_proxy_vazio_conta_como_ausente():
    ambiente = {**AMBIENTE_COMPLETO, "APPLE_PROXY": "   "}
    with pytest.raises(ConfiguracaoInvalida):
        carregar_config(ambiente)


def test_sem_chave_de_servico_recusa_subir():
    ambiente = {k: v for k, v in AMBIENTE_COMPLETO.items() if k != "MOTOR_API_KEY"}
    with pytest.raises(ConfiguracaoInvalida) as erro:
        carregar_config(ambiente)
    assert "MOTOR_API_KEY" in str(erro.value)


def test_intervalo_abaixo_do_piso_e_elevado():
    cfg = carregar_config({**AMBIENTE_COMPLETO, "INTERVALO_S": "300"})
    assert cfg.intervalo_s == INTERVALO_MINIMO_S


def test_intervalo_acima_do_piso_e_respeitado():
    cfg = carregar_config({**AMBIENTE_COMPLETO, "INTERVALO_S": "3600"})
    assert cfg.intervalo_s == 3600


def test_intervalo_ausente_usa_o_piso():
    cfg = carregar_config(AMBIENTE_COMPLETO)
    assert cfg.intervalo_s == INTERVALO_MINIMO_S


def test_intervalo_nao_numerico_usa_o_piso():
    cfg = carregar_config({**AMBIENTE_COMPLETO, "INTERVALO_S": "rapido"})
    assert cfg.intervalo_s == INTERVALO_MINIMO_S
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Run: `python -m pytest tests/test_config.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.config'`

- [ ] **Step 5: Escrever a implementação mínima**

`motor/config.py`:

```python
"""
Lê e valida o ambiente do motor.

Duas exigências não são negociáveis e por isso moram aqui, na porta de entrada:

  1. Sem proxy residencial o motor não sobe. A Apple bloqueia consulta vinda de
     datacenter devolvendo lista vazia SEM erro — indistinguível de "ninguém viu
     a TAG". Subir assim seria pior que não subir: a frota inteira apareceria
     como silenciosa e ninguém saberia por quê.

  2. O intervalo tem piso de 30 minutos. Configurar menos não funciona: o valor
     é elevado aqui mesmo. Consultar de 5 em 5 minutos bane a conta Apple, e a
     latência da própria rede já é maior que o piso.
"""
from dataclasses import dataclass

INTERVALO_MINIMO_S = 1800


class ConfiguracaoInvalida(RuntimeError):
    """O ambiente não permite operar com segurança."""


@dataclass(frozen=True)
class Config:
    api_base: str
    api_key: str
    apple_proxy: str
    anisette_url: str
    contas_path: str
    fila_path: str
    intervalo_s: int


def _obrigatorio(ambiente: dict, chave: str, motivo: str) -> str:
    valor = (ambiente.get(chave) or "").strip()
    if not valor:
        raise ConfiguracaoInvalida(f"{chave} não configurado — {motivo}")
    return valor


def _intervalo(ambiente: dict) -> int:
    bruto = (ambiente.get("INTERVALO_S") or "").strip()
    try:
        pedido = int(bruto)
    except ValueError:
        return INTERVALO_MINIMO_S
    return max(INTERVALO_MINIMO_S, pedido)


def carregar_config(ambiente: dict) -> Config:
    return Config(
        api_base=_obrigatorio(
            ambiente, "API_BASE_URL", "o motor não sabe a quem entregar as posições"
        ),
        api_key=_obrigatorio(
            ambiente, "MOTOR_API_KEY", "o backend recusaria toda entrega"
        ),
        apple_proxy=_obrigatorio(
            ambiente,
            "APPLE_PROXY",
            "sem proxy residencial a Apple devolve lista vazia sem erro, "
            "e a frota inteira pareceria silenciosa",
        ),
        anisette_url=(ambiente.get("ANISETTE_URL") or "http://anisette:6969").strip(),
        contas_path=(ambiente.get("CONTAS_PATH") or "/app/contas.json").strip(),
        fila_path=(ambiente.get("FILA_PATH") or "/app/fila").strip(),
        intervalo_s=_intervalo(ambiente),
    )
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `python -m pytest tests/test_config.py -v`
Expected: PASS — 8 testes

- [ ] **Step 7: Commit**

```bash
git add motor/ tests/ requirements.txt pytest.ini .gitignore
git commit -m "feat(motor): configuracao que se recusa a subir sem proxy residencial"
```

---

# Task 2: Abrir o envelope da Apple

O coração do produto. Este código é portado de `biemster/FindMy` e existe hoje em `21 - RASTREAMENTO/worker-findmy/findmy_crypto.py`. **É cópia literal.** Qualquer "melhoria" aqui quebra a decifragem em silêncio e a TAG vira um ponto no meio do oceano.

**Files:**
- Create: `motor/cripto.py`
- Test: `tests/test_cripto.py`

**Interfaces:**
- Consumes: nada.
- Produces: `abrir_relatorio(payload_b64: str, chave_privada_b64: str) -> dict` com as chaves `lat: float`, `lon: float`, `conf: int`, `status: int`, `timestamp: int`, `isodatetime: str`.
- Produces: `EPOCH_APPLE_PARA_UNIX = 978307200`.

- [ ] **Step 1: Copiar o arquivo de origem**

```bash
cp "/c/Users/damas/Documents/PROJETOS/21 GO/21 - RASTREAMENTO/worker-findmy/findmy_crypto.py" motor/cripto.py
```

- [ ] **Step 2: Renomear a função pública para o padrão do projeto**

Em `motor/cripto.py`, trocar a assinatura `def decrypt_report(payload_b64: str, private_key_b64: str) -> dict:` por:

```python
def abrir_relatorio(payload_b64: str, chave_privada_b64: str) -> dict:
```

E, dentro dela, trocar as duas primeiras linhas do corpo por:

```python
    priv = int.from_bytes(b64decode(chave_privada_b64), "big")
    data = b64decode(payload_b64)
```

Nada mais muda. As constantes, o descarte do byte 4, a derivação ECDH e o AES-GCM ficam byte a byte como estão.

- [ ] **Step 3: Escrever o teste de ida e volta**

O teste monta um relatório exatamente como um iPhone montaria e confere que a coordenada exata volta. É o único teste que prova que a decifragem funciona sem depender da Apple.

`tests/test_cripto.py`:

```python
import hashlib
import struct
from base64 import b64encode
from datetime import datetime, timezone

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from motor.cripto import EPOCH_APPLE_PARA_UNIX, abrir_relatorio

LAT = -22.938804
LNG = -43.560138
PRECISAO = 12
STATUS = 0


def _montar_relatorio(lat, lng, precisao, status, quando_unix, chave_privada_int):
    """Faz o que um iPhone faz ao avistar a TAG: cifra a propria posicao com a
    chave publica dela, usando uma chave efemera descartavel."""
    privada = ec.derive_private_key(chave_privada_int, ec.SECP224R1(), default_backend())
    publica_da_tag = privada.public_key()

    efemera = ec.generate_private_key(ec.SECP224R1(), default_backend())
    efemera_bytes = efemera.public_key().public_bytes(
        encoding=__import__("cryptography").hazmat.primitives.serialization.Encoding.X962,
        format=__import__("cryptography").hazmat.primitives.serialization.PublicFormat.UncompressedPoint,
    )
    assert len(efemera_bytes) == 57

    segredo = efemera.exchange(ec.ECDH(), publica_da_tag)
    simetrica = hashlib.sha256(segredo + b"\x00\x00\x00\x01" + efemera_bytes).digest()
    chave_aes, iv = simetrica[:16], simetrica[16:]

    claro = (
        struct.pack(">i", int(lat * 10000000))
        + struct.pack(">i", int(lng * 10000000))
        + precisao.to_bytes(1, "big")
        + status.to_bytes(1, "big")
    )
    cifrador = Cipher(
        algorithms.AES(chave_aes), modes.GCM(iv), default_backend()
    ).encryptor()
    cifrado = cifrador.update(claro) + cifrador.finalize()

    corpo = (
        (quando_unix - EPOCH_APPLE_PARA_UNIX).to_bytes(4, "big")
        + b"\x00"
        + efemera_bytes
        + cifrado
        + cifrador.tag
    )
    return b64encode(corpo).decode()


def test_recupera_a_coordenada_exata():
    chave_privada_int = 0x1F2E3D4C5B6A798877665544332211FFEEDDCCBBAA99887766554433
    quando = int(datetime(2026, 8, 29, 12, 0, 0, tzinfo=timezone.utc).timestamp())
    privada_b64 = b64encode(chave_privada_int.to_bytes(28, "big")).decode()

    payload = _montar_relatorio(LAT, LNG, PRECISAO, STATUS, quando, chave_privada_int)
    aberto = abrir_relatorio(payload, privada_b64)

    assert round(aberto["lat"], 6) == round(LAT, 6)
    assert round(aberto["lon"], 6) == round(LNG, 6)
    assert aberto["conf"] == PRECISAO
    assert aberto["timestamp"] == quando
    assert aberto["isodatetime"].startswith("2026-08-29T12:00:00")


def test_chave_errada_levanta_excecao():
    certa = 0x1F2E3D4C5B6A798877665544332211FFEEDDCCBBAA99887766554433
    errada = 0x0A0B0C0D0E0F101112131415161718191A1B1C1D1E1F202122232425
    quando = int(datetime(2026, 8, 29, 12, 0, 0, tzinfo=timezone.utc).timestamp())

    payload = _montar_relatorio(LAT, LNG, PRECISAO, STATUS, quando, certa)
    errada_b64 = b64encode(errada.to_bytes(28, "big")).decode()

    try:
        abrir_relatorio(payload, errada_b64)
    except Exception:
        return
    raise AssertionError("relatorio abriu com a chave errada")
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_cripto.py -v`
Expected: PASS — 2 testes

Se falhar em `abrir_relatorio`, o arquivo foi editado além do renomeio. Restaure a cópia e refaça apenas o Step 2.

- [ ] **Step 5: Commit**

```bash
git add motor/cripto.py tests/test_cripto.py
git commit -m "feat(motor): decifragem dos relatorios Find My com teste de ida e volta"
```

---

# Task 3: Fatiar em lotes de 256

**Files:**
- Create: `motor/lotes.py`
- Test: `tests/test_lotes.py`

**Interfaces:**
- Produces: `TAMANHO_DO_LOTE = 256`.
- Produces: `fatiar(itens: list, tamanho: int = TAMANHO_DO_LOTE) -> list[list]`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_lotes.py`:

```python
from motor.lotes import TAMANHO_DO_LOTE, fatiar


def test_o_lote_tem_256_por_padrao():
    assert TAMANHO_DO_LOTE == 256


def test_lista_menor_que_o_lote_vira_um_lote_so():
    assert fatiar(["a", "b", "c"]) == [["a", "b", "c"]]


def test_lista_vazia_nao_gera_lote_nenhum():
    assert fatiar([]) == []


def test_divide_exatamente_no_limite():
    lotes = fatiar(list(range(512)))
    assert len(lotes) == 2
    assert len(lotes[0]) == 256
    assert len(lotes[1]) == 256


def test_o_resto_vai_no_ultimo_lote():
    lotes = fatiar(list(range(257)))
    assert len(lotes) == 2
    assert len(lotes[1]) == 1


def test_nenhum_item_se_perde_nem_se_repete():
    itens = list(range(1000))
    juntos = [x for lote in fatiar(itens) for x in lote]
    assert juntos == itens
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_lotes.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.lotes'`

- [ ] **Step 3: Escrever a implementação**

`motor/lotes.py`:

```python
"""
Fatia a lista de chaves no tamanho que a Apple aceita por consulta.

256 é o teto por requisição. Mandar mais numa tacada não devolve erro claro —
devolve resposta incompleta, que é pior.
"""

TAMANHO_DO_LOTE = 256


def fatiar(itens: list, tamanho: int = TAMANHO_DO_LOTE) -> list[list]:
    return [itens[i : i + tamanho] for i in range(0, len(itens), tamanho)]
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_lotes.py -v`
Expected: PASS — 6 testes

- [ ] **Step 5: Commit**

```bash
git add motor/lotes.py tests/test_lotes.py
git commit -m "feat(motor): fatiamento em lotes de 256 chaves"
```

---

# Task 4: Pool de contas Apple com distribuição estável

Uma conta banida não pode derrubar a base inteira. Cada conta cobre um pedaço, e **a mesma TAG cai sempre na mesma conta** — se ela mudasse de conta a cada ciclo, a Apple veria a mesma chave sendo perguntada por várias identidades, que é justamente o padrão que chama atenção.

**Files:**
- Create: `motor/contas.py`
- Test: `tests/test_contas.py`

**Interfaces:**
- Consumes: nada.
- Produces: `@dataclass(frozen=True) class Conta` com `nome: str`, `apple_id: str`, `sessao_path: str`.
- Produces: `carregar_contas(bruto: list[dict]) -> list[Conta]`.
- Produces: `class SemContas(RuntimeError)`.
- Produces: `distribuir(chaves: list[str], contas: list[Conta]) -> dict[str, list[str]]` — devolve mapa de `Conta.nome` para as chaves daquela conta.

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_contas.py`:

```python
import pytest

from motor.contas import Conta, SemContas, carregar_contas, distribuir

BRUTO = [
    {"nome": "conta-a", "appleId": "a@exemplo.com", "sessaoPath": "/app/sessoes/a.json"},
    {"nome": "conta-b", "appleId": "b@exemplo.com", "sessaoPath": "/app/sessoes/b.json"},
]


def test_carrega_o_pool():
    contas = carregar_contas(BRUTO)
    assert [c.nome for c in contas] == ["conta-a", "conta-b"]
    assert contas[0].apple_id == "a@exemplo.com"
    assert contas[0].sessao_path == "/app/sessoes/a.json"


def test_pool_vazio_e_erro():
    with pytest.raises(SemContas):
        carregar_contas([])


def test_conta_sem_nome_e_erro():
    with pytest.raises(SemContas):
        carregar_contas([{"appleId": "a@exemplo.com", "sessaoPath": "/x.json"}])


def test_nome_repetido_e_erro():
    repetido = [BRUTO[0], {**BRUTO[1], "nome": "conta-a"}]
    with pytest.raises(SemContas):
        carregar_contas(repetido)


def test_toda_chave_cai_em_alguma_conta():
    contas = carregar_contas(BRUTO)
    chaves = [f"chave-{i}" for i in range(100)]
    mapa = distribuir(chaves, contas)
    juntas = sorted(k for lista in mapa.values() for k in lista)
    assert juntas == sorted(chaves)


def test_a_mesma_chave_cai_sempre_na_mesma_conta():
    contas = carregar_contas(BRUTO)
    primeira = distribuir([f"chave-{i}" for i in range(50)], contas)
    segunda = distribuir([f"chave-{i}" for i in range(50)], contas)
    assert primeira == segunda


def test_a_ordem_da_entrada_nao_muda_o_resultado():
    contas = carregar_contas(BRUTO)
    chaves = [f"chave-{i}" for i in range(50)]
    normal = distribuir(chaves, contas)
    invertida = distribuir(list(reversed(chaves)), contas)
    assert {c: sorted(v) for c, v in normal.items()} == {
        c: sorted(v) for c, v in invertida.items()
    }


def test_distribuicao_e_razoavelmente_equilibrada():
    contas = carregar_contas(BRUTO)
    mapa = distribuir([f"chave-{i}" for i in range(1000)], contas)
    tamanhos = sorted(len(v) for v in mapa.values())
    assert tamanhos[0] > 300


def test_toda_conta_aparece_no_mapa_mesmo_sem_chave():
    contas = carregar_contas(BRUTO)
    mapa = distribuir([], contas)
    assert set(mapa.keys()) == {"conta-a", "conta-b"}
    assert mapa["conta-a"] == []


def test_sem_conta_nao_distribui():
    with pytest.raises(SemContas):
        distribuir(["chave-1"], [])
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_contas.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.contas'`

- [ ] **Step 3: Escrever a implementação**

`motor/contas.py`:

```python
"""
O pool de contas Apple.

Uma conta só não serve: se ela é banida, a base inteira some do mapa no mesmo
instante. Cada conta cobre um pedaço.

A distribuição é por hash estável da chave, e não por rodízio, por um motivo
operacional: a mesma TAG precisa cair sempre na mesma conta. Se ela trocasse de
conta a cada ciclo, a Apple veria a mesma chave sendo perguntada por várias
identidades diferentes — que é exatamente o padrão anômalo que se quer evitar.

Usamos sha256 e não hash() do Python: hash() de string é aleatorizado por
processo (PYTHONHASHSEED), então a distribuição mudaria a cada restart.
"""
import hashlib
from dataclasses import dataclass


class SemContas(RuntimeError):
    """Não há pool utilizável."""


@dataclass(frozen=True)
class Conta:
    nome: str
    apple_id: str
    sessao_path: str


def carregar_contas(bruto: list[dict]) -> list[Conta]:
    if not bruto:
        raise SemContas("nenhuma conta Apple configurada — o motor não consulta nada")

    contas = []
    vistos = set()
    for item in bruto:
        nome = (item.get("nome") or "").strip()
        if not nome:
            raise SemContas("conta sem 'nome' no arquivo de contas")
        if nome in vistos:
            raise SemContas(f"nome de conta repetido: {nome}")
        vistos.add(nome)
        contas.append(
            Conta(
                nome=nome,
                apple_id=(item.get("appleId") or "").strip(),
                sessao_path=(item.get("sessaoPath") or "").strip(),
            )
        )
    return contas


def _indice(chave: str, quantidade: int) -> int:
    digest = hashlib.sha256(chave.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % quantidade


def distribuir(chaves: list[str], contas: list[Conta]) -> dict[str, list[str]]:
    if not contas:
        raise SemContas("não há conta para distribuir as chaves")

    mapa: dict[str, list[str]] = {c.nome: [] for c in contas}
    for chave in chaves:
        alvo = contas[_indice(chave, len(contas))]
        mapa[alvo.nome].append(chave)
    return mapa
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_contas.py -v`
Expected: PASS — 10 testes

- [ ] **Step 5: Commit**

```bash
git add motor/contas.py tests/test_contas.py
git commit -m "feat(motor): pool de contas Apple com distribuicao estavel por hash"
```

---

# Task 5: Saúde das contas

Conta que falhou várias vezes seguidas sai do rodízio, e as chaves dela precisam voltar para o bolo. Sem isso, uma conta banida engole silenciosamente a fatia dela da frota.

**Files:**
- Create: `motor/saude.py`
- Test: `tests/test_saude.py`

**Interfaces:**
- Consumes: `Conta` de `motor/contas.py`.
- Produces: `FALHAS_PARA_SUSPENDER = 3`.
- Produces: `class Saude` com `registrar_sucesso(nome: str) -> None`, `registrar_falha(nome: str, motivo: str) -> None`, `esta_saudavel(nome: str) -> bool`, `saudaveis(contas: list[Conta]) -> list[Conta]`, `resumo() -> dict[str, dict]`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_saude.py`:

```python
from motor.contas import Conta
from motor.saude import FALHAS_PARA_SUSPENDER, Saude

CONTAS = [
    Conta(nome="conta-a", apple_id="a@x.com", sessao_path="/a.json"),
    Conta(nome="conta-b", apple_id="b@x.com", sessao_path="/b.json"),
]


def test_conta_nova_nasce_saudavel():
    s = Saude()
    assert s.esta_saudavel("conta-a") is True


def test_uma_falha_nao_suspende():
    s = Saude()
    s.registrar_falha("conta-a", "timeout")
    assert s.esta_saudavel("conta-a") is True


def test_falhas_seguidas_suspendem():
    s = Saude()
    for _ in range(FALHAS_PARA_SUSPENDER):
        s.registrar_falha("conta-a", "401 da Apple")
    assert s.esta_saudavel("conta-a") is False


def test_sucesso_zera_o_contador():
    s = Saude()
    s.registrar_falha("conta-a", "timeout")
    s.registrar_falha("conta-a", "timeout")
    s.registrar_sucesso("conta-a")
    s.registrar_falha("conta-a", "timeout")
    assert s.esta_saudavel("conta-a") is True


def test_sucesso_reabilita_conta_suspensa():
    s = Saude()
    for _ in range(FALHAS_PARA_SUSPENDER):
        s.registrar_falha("conta-a", "timeout")
    s.registrar_sucesso("conta-a")
    assert s.esta_saudavel("conta-a") is True


def test_a_falha_de_uma_nao_contamina_a_outra():
    s = Saude()
    for _ in range(FALHAS_PARA_SUSPENDER):
        s.registrar_falha("conta-a", "timeout")
    assert s.esta_saudavel("conta-b") is True


def test_saudaveis_filtra_a_lista():
    s = Saude()
    for _ in range(FALHAS_PARA_SUSPENDER):
        s.registrar_falha("conta-a", "timeout")
    assert [c.nome for c in s.saudaveis(CONTAS)] == ["conta-b"]


def test_resumo_guarda_o_ultimo_motivo():
    s = Saude()
    s.registrar_falha("conta-a", "proxy recusou conexao")
    assert s.resumo()["conta-a"]["ultimo_motivo"] == "proxy recusou conexao"
    assert s.resumo()["conta-a"]["falhas_seguidas"] == 1
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_saude.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.saude'`

- [ ] **Step 3: Escrever a implementação**

`motor/saude.py`:

```python
"""
Quem está de pé e quem não está.

Conta que falha três vezes seguidas sai do rodízio até voltar a funcionar. O
motivo de contar falhas SEGUIDAS e não falhas totais: um timeout isolado não
diz nada, três seguidos dizem que a conta caiu ou foi bloqueada.

Este estado vive no processo. Reiniciar o motor devolve todas as contas ao
rodízio, e isso é proposital: depois de um restart, tentar de novo é barato e
a informação anterior pode estar velha.
"""
from motor.contas import Conta

FALHAS_PARA_SUSPENDER = 3


class Saude:
    def __init__(self):
        self._falhas: dict[str, int] = {}
        self._motivos: dict[str, str] = {}

    def registrar_sucesso(self, nome: str) -> None:
        self._falhas[nome] = 0
        self._motivos.pop(nome, None)

    def registrar_falha(self, nome: str, motivo: str) -> None:
        self._falhas[nome] = self._falhas.get(nome, 0) + 1
        self._motivos[nome] = motivo

    def esta_saudavel(self, nome: str) -> bool:
        return self._falhas.get(nome, 0) < FALHAS_PARA_SUSPENDER

    def saudaveis(self, contas: list[Conta]) -> list[Conta]:
        return [c for c in contas if self.esta_saudavel(c.nome)]

    def resumo(self) -> dict[str, dict]:
        return {
            nome: {
                "falhas_seguidas": quantidade,
                "ultimo_motivo": self._motivos.get(nome),
                "saudavel": self.esta_saudavel(nome),
            }
            for nome, quantidade in self._falhas.items()
        }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_saude.py -v`
Expected: PASS — 8 testes

- [ ] **Step 5: Commit**

```bash
git add motor/saude.py tests/test_saude.py
git commit -m "feat(motor): saude das contas tira do rodizio quem falhou tres vezes"
```

---

# Task 6: Memória do processo — deduplicação e backfill

A Apple devolve a mesma janela a cada consulta. Sem memória, cada ciclo reenviaria a semana inteira.

**Files:**
- Create: `motor/memoria.py`
- Test: `tests/test_memoria.py`

**Interfaces:**
- Produces: `class Dedupe` com `ja_enviado(payload: dict) -> bool`, `marcar(payload: dict) -> None`, `__len__()`. A identidade de um avistamento é `hashedAdvKey` + `vistoEm`.
- Produces: `class ControleDeBackfill` com `horas_para_o_ciclo(tags: list[dict]) -> int` e `atualizar(tags: list[dict], chaves_com_relatorio: set) -> None`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_memoria.py`:

```python
from motor.memoria import ControleDeBackfill, Dedupe


def _avistamento(chave="k1", visto="2026-08-29T12:00:00+00:00"):
    return {"hashedAdvKey": chave, "vistoEm": visto}


def test_o_primeiro_nunca_foi_enviado():
    d = Dedupe()
    assert d.ja_enviado(_avistamento()) is False


def test_marcado_passa_a_ser_conhecido():
    d = Dedupe()
    d.marcar(_avistamento())
    assert d.ja_enviado(_avistamento()) is True


def test_hora_diferente_e_outro_avistamento():
    d = Dedupe()
    d.marcar(_avistamento(visto="2026-08-29T12:00:00+00:00"))
    assert d.ja_enviado(_avistamento(visto="2026-08-29T12:30:00+00:00")) is False


def test_tag_diferente_e_outro_avistamento():
    d = Dedupe()
    d.marcar(_avistamento(chave="k1"))
    assert d.ja_enviado(_avistamento(chave="k2")) is False


def test_a_memoria_tem_teto():
    d = Dedupe(limite=10)
    for i in range(25):
        d.marcar(_avistamento(chave=f"k{i}"))
    assert len(d) == 10


def test_o_mais_antigo_e_esquecido_primeiro():
    d = Dedupe(limite=2)
    d.marcar(_avistamento(chave="k1"))
    d.marcar(_avistamento(chave="k2"))
    d.marcar(_avistamento(chave="k3"))
    assert d.ja_enviado(_avistamento(chave="k1")) is False
    assert d.ja_enviado(_avistamento(chave="k3")) is True


def test_a_janela_do_ciclo_e_a_maior_pedida():
    c = ControleDeBackfill()
    tags = [
        {"hashedAdvKey": "k1", "backfillHours": 1},
        {"hashedAdvKey": "k2", "backfillHours": 168},
    ]
    assert c.horas_para_o_ciclo(tags) == 168


def test_sem_tag_a_janela_e_zero():
    assert ControleDeBackfill().horas_para_o_ciclo([]) == 0


def test_quem_ja_baixou_pede_janela_curta_na_proxima():
    c = ControleDeBackfill(janela_curta_horas=1)
    tags = [{"hashedAdvKey": "k1", "backfillHours": 168}]
    c.atualizar(tags, chaves_com_relatorio={"k1"})
    assert c.horas_para_o_ciclo(tags) == 1


def test_resposta_vazia_nao_marca_como_baixado():
    c = ControleDeBackfill(janela_curta_horas=1)
    tags = [{"hashedAdvKey": "k1", "backfillHours": 168}]
    c.atualizar(tags, chaves_com_relatorio=set())
    assert c.horas_para_o_ciclo(tags) == 168


def test_tag_que_saiu_do_acelerado_volta_a_ser_elegivel():
    c = ControleDeBackfill(janela_curta_horas=1)
    acelerada = [{"hashedAdvKey": "k1", "backfillHours": 168}]
    c.atualizar(acelerada, chaves_com_relatorio={"k1"})
    c.atualizar([{"hashedAdvKey": "k1", "backfillHours": 0}], chaves_com_relatorio=set())
    assert c.horas_para_o_ciclo(acelerada) == 168
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_memoria.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.memoria'`

- [ ] **Step 3: Escrever a implementação**

`motor/memoria.py`:

```python
"""
O que o processo lembra entre um ciclo e outro.

Duas memórias curtas, as duas de propósito dentro do processo e não em disco:
reiniciar o motor pode reenviar alguma coisa, e reenviar é barato — o backend
deduplica. Perder posição, não.
"""
from collections import OrderedDict


class Dedupe:
    """A Apple devolve a mesma janela a cada consulta. Sem isto, cada ciclo
    reenviaria a semana inteira. A identidade de um avistamento é a TAG mais o
    instante em que ela foi vista."""

    def __init__(self, limite: int = 20000):
        self._limite = limite
        self._vistos: OrderedDict = OrderedDict()

    def _chave(self, payload: dict) -> str:
        return f"{payload['hashedAdvKey']}|{payload['vistoEm']}"

    def ja_enviado(self, payload: dict) -> bool:
        return self._chave(payload) in self._vistos

    def marcar(self, payload: dict) -> None:
        chave = self._chave(payload)
        self._vistos[chave] = True
        self._vistos.move_to_end(chave)
        while len(self._vistos) > self._limite:
            self._vistos.popitem(last=False)

    def __len__(self) -> int:
        return len(self._vistos)


class ControleDeBackfill:
    """Quem já teve a semana inteira baixada não pede a semana de novo.

    O backend manda `backfillHours` alto (até 168h, o limite de retenção da
    Apple) para justificar o primeiro ciclo de uma TAG marcada como sumida. Sem
    controle, enquanto ela seguisse marcada o motor pediria a semana inteira a
    cada 30 minutos — pelo proxy residencial pago, que é o recurso mais fácil de
    esgotar aqui.

    Só marca como baixado quem realmente veio na resposta: bloqueio de IP
    responde 200 com lista vazia, igualzinho a "ninguém viu a TAG", e marcar
    nesse caso apagaria para sempre a chance de recuperar a semana do sumiço.
    """

    def __init__(self, janela_curta_horas: int = 1):
        self._janela_curta_horas = janela_curta_horas
        self._ja_baixados: set[str] = set()

    def horas_para_o_ciclo(self, tags: list[dict]) -> int:
        horas = []
        for tag in tags:
            pedido = tag.get("backfillHours", 0)
            chave = tag.get("hashedAdvKey")
            if pedido > 0 and chave in self._ja_baixados:
                horas.append(self._janela_curta_horas)
            else:
                horas.append(pedido)
        return max(horas) if horas else 0

    def atualizar(self, tags: list[dict], chaves_com_relatorio: set) -> None:
        for tag in tags:
            chave = tag.get("hashedAdvKey")
            if tag.get("backfillHours", 0) > 0:
                if chave in chaves_com_relatorio:
                    self._ja_baixados.add(chave)
            else:
                self._ja_baixados.discard(chave)
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_memoria.py -v`
Expected: PASS — 11 testes

- [ ] **Step 5: Commit**

```bash
git add motor/memoria.py tests/test_memoria.py
git commit -m "feat(motor): memoria de deduplicacao e controle de backfill"
```

---

# Task 7: Fila em disco

Relatório da Apple vence em 7 dias. Se o backend cair e o motor guardar em memória, um restart apaga posição de veículo roubado. Vai para disco.

Adaptado de `21 - RASTREAMENTO/ktag-findmy-worker/findmy_worker/outbox.py`.

**Files:**
- Create: `motor/fila.py`
- Test: `tests/test_fila.py`

**Interfaces:**
- Produces: `class Fila` com `__init__(pasta: Path)`, `guardar(payload: dict) -> Path`, `pendentes() -> list[tuple[Path, dict]]`, `remover(caminho: Path) -> None`, `quarentenar(caminho: Path, motivo: str) -> None`, `quarentenados() -> list[Path]`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_fila.py`:

```python
import json

from motor.fila import Fila


def test_guarda_e_devolve(tmp_path):
    f = Fila(tmp_path / "fila")
    f.guardar({"tagId": "t1", "lat": -22.9})
    pendentes = f.pendentes()
    assert len(pendentes) == 1
    assert pendentes[0][1]["tagId"] == "t1"


def test_remover_tira_da_fila(tmp_path):
    f = Fila(tmp_path / "fila")
    caminho = f.guardar({"tagId": "t1"})
    f.remover(caminho)
    assert f.pendentes() == []


def test_sobrevive_a_um_processo_novo(tmp_path):
    Fila(tmp_path / "fila").guardar({"tagId": "t1"})
    assert len(Fila(tmp_path / "fila").pendentes()) == 1


def test_arquivo_corrompido_vai_para_quarentena(tmp_path):
    pasta = tmp_path / "fila"
    f = Fila(pasta)
    f.guardar({"tagId": "t1"})
    (pasta / "quebrado.json").write_text("{isso nao e json", encoding="utf-8")

    pendentes = f.pendentes()
    assert len(pendentes) == 1
    assert len(f.quarentenados()) == 1


def test_tmp_orfao_de_queda_vai_para_quarentena_no_boot(tmp_path):
    pasta = tmp_path / "fila"
    pasta.mkdir(parents=True)
    (pasta / "meio-escrito.tmp").write_text('{"tagId": "t1"', encoding="utf-8")

    f = Fila(pasta)
    assert f.pendentes() == []
    assert len(f.quarentenados()) == 1


def test_quarentenar_por_rejeicao_definitiva(tmp_path):
    f = Fila(tmp_path / "fila")
    caminho = f.guardar({"tagId": "t1"})
    f.quarentenar(caminho, "backend devolveu 422")
    assert f.pendentes() == []
    assert len(f.quarentenados()) == 1


def test_a_ordem_de_entrega_e_estavel(tmp_path):
    f = Fila(tmp_path / "fila")
    for i in range(5):
        f.guardar({"tagId": f"t{i}"})
    primeira = [c for c, _ in f.pendentes()]
    segunda = [c for c, _ in f.pendentes()]
    assert primeira == segunda


def test_o_conteudo_gravado_e_json_valido(tmp_path):
    f = Fila(tmp_path / "fila")
    caminho = f.guardar({"tagId": "t1", "precisaoM": 12})
    assert json.loads(caminho.read_text(encoding="utf-8"))["precisaoM"] == 12
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_fila.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.fila'`

- [ ] **Step 3: Escrever a implementação**

`motor/fila.py`:

```python
"""
Fila em disco do que ainda não chegou ao backend.

A Apple guarda 7 dias e apaga. O que já baixamos e não entregamos só existe
aqui — em memória, um restart apagaria a posição de um bem roubado. Por isso
disco, e por isso escrita atômica (grava .tmp e renomeia): um processo morto no
meio da escrita não pode deixar um JSON pela metade na fila.
"""
import json
import logging
import os
import uuid
from pathlib import Path

log = logging.getLogger(__name__)


class Fila:
    def __init__(self, pasta):
        self._pasta = Path(pasta)
        self._pasta.mkdir(parents=True, exist_ok=True)
        self._quarentena = self._pasta / "quarentena"
        self._varrer_tmp_orfaos()

    def _varrer_tmp_orfaos(self) -> None:
        """Todo .tmp presente no boot é resto de escrita interrompida por um
        processo que já morreu. Não há TTL envolvido: a própria existência do
        arquivo neste momento já prova isso."""
        for tmp in self._pasta.glob("*.tmp"):
            self._mover_para_quarentena(tmp, "escrita interrompida por queda do processo")

    def guardar(self, payload: dict) -> Path:
        caminho = self._pasta / f"{uuid.uuid4().hex}.json"
        temporario = caminho.with_suffix(".tmp")
        temporario.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(temporario, caminho)
        return caminho

    def pendentes(self) -> list:
        itens = []
        for caminho in sorted(self._pasta.glob("*.json")):
            try:
                itens.append((caminho, json.loads(caminho.read_text(encoding="utf-8"))))
            except (json.JSONDecodeError, UnicodeDecodeError) as erro:
                self._mover_para_quarentena(caminho, str(erro))
        return itens

    def quarentenados(self) -> list:
        self._quarentena.mkdir(parents=True, exist_ok=True)
        return sorted(p for p in self._quarentena.iterdir() if p.is_file())

    def quarentenar(self, caminho, motivo: str) -> None:
        """Para quando o backend rejeita o conteúdo em definitivo. Sem isto o
        item tentaria de novo para sempre, travando tudo que está atrás."""
        self._mover_para_quarentena(Path(caminho), motivo)

    def remover(self, caminho) -> None:
        Path(caminho).unlink(missing_ok=True)

    def _mover_para_quarentena(self, caminho: Path, motivo: str) -> None:
        log.warning("payload em quarentena (%s): %s", motivo, caminho.name)
        self._quarentena.mkdir(parents=True, exist_ok=True)
        os.replace(caminho, self._quarentena / caminho.name)
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_fila.py -v`
Expected: PASS — 8 testes

- [ ] **Step 5: Commit**

```bash
git add motor/fila.py tests/test_fila.py
git commit -m "feat(motor): fila em disco com escrita atomica e quarentena"
```

---

# Task 8: Borda com o backend

**Files:**
- Create: `motor/backend.py`
- Test: `tests/test_backend.py`

**Interfaces:**
- Consumes: nada dos módulos anteriores.
- Produces: `class ErroPermanente(Exception)`, `class ErroTransitorio(Exception)`, `class ErroDeCredencial(Exception)`.
- Produces: `class ClienteBackend` com `__init__(base_url: str, api_key: str, transporte=None)`, `plano() -> list[dict]`, `enviar_lote(avistamentos: list[dict]) -> dict`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_backend.py`:

```python
import httpx
import pytest

from motor.backend import (
    ClienteBackend,
    ErroDeCredencial,
    ErroPermanente,
    ErroTransitorio,
)

TAG = {
    "tagId": "t1",
    "hashedAdvKey": "hash-1",
    "privateKey": "priv-1",
    "backfillHours": 1,
}


def _cliente(handler):
    return ClienteBackend(
        "https://api.monitorabem.site",
        "chave-de-servico",
        transporte=httpx.MockTransport(handler),
    )


def test_plano_devolve_as_tags():
    def handler(request):
        assert request.url.path == "/interno/motor/plano"
        return httpx.Response(200, json={"tags": [TAG]})

    assert _cliente(handler).plano() == [TAG]


def test_plano_manda_a_chave_de_servico():
    vistos = {}

    def handler(request):
        vistos["chave"] = request.headers.get("X-Motor-Key")
        return httpx.Response(200, json={"tags": []})

    _cliente(handler).plano()
    assert vistos["chave"] == "chave-de-servico"


def test_plano_sem_a_chave_tags_devolve_lista_vazia():
    def handler(request):
        return httpx.Response(200, json={})

    assert _cliente(handler).plano() == []


def test_plano_com_token_recusado_e_erro_de_credencial():
    def handler(request):
        return httpx.Response(401, json={"message": "nao autorizado"})

    with pytest.raises(ErroDeCredencial):
        _cliente(handler).plano()


def test_envio_bem_sucedido_devolve_o_resumo():
    def handler(request):
        assert request.url.path == "/interno/motor/avistamentos"
        return httpx.Response(200, json={"aceitos": 2, "duplicados": 1})

    resumo = _cliente(handler).enviar_lote([{"tagId": "t1"}, {"tagId": "t2"}])
    assert resumo == {"aceitos": 2, "duplicados": 1}


def test_envio_manda_o_lote_dentro_da_chave_avistamentos():
    corpos = {}

    def handler(request):
        corpos["json"] = request.read().decode()
        return httpx.Response(200, json={"aceitos": 1, "duplicados": 0})

    _cliente(handler).enviar_lote([{"tagId": "t1"}])
    assert '"avistamentos"' in corpos["json"]


def test_lote_vazio_nao_bate_no_backend():
    def handler(request):
        raise AssertionError("nao deveria ter chamado o backend")

    assert _cliente(handler).enviar_lote([]) == {"aceitos": 0, "duplicados": 0}


def test_422_e_erro_permanente():
    def handler(request):
        return httpx.Response(422, json={"message": "coordenada invalida"})

    with pytest.raises(ErroPermanente):
        _cliente(handler).enviar_lote([{"tagId": "t1"}])


def test_429_e_transitorio():
    def handler(request):
        return httpx.Response(429, json={"message": "devagar"})

    with pytest.raises(ErroTransitorio):
        _cliente(handler).enviar_lote([{"tagId": "t1"}])


def test_500_e_transitorio():
    def handler(request):
        return httpx.Response(500, text="boom")

    with pytest.raises(ErroTransitorio):
        _cliente(handler).enviar_lote([{"tagId": "t1"}])


def test_403_e_erro_de_credencial():
    def handler(request):
        return httpx.Response(403, json={"message": "proibido"})

    with pytest.raises(ErroDeCredencial):
        _cliente(handler).enviar_lote([{"tagId": "t1"}])


def test_falha_de_rede_e_transitoria():
    def handler(request):
        raise httpx.ConnectError("conexao recusada")

    with pytest.raises(ErroTransitorio):
        _cliente(handler).enviar_lote([{"tagId": "t1"}])
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_backend.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.backend'`

- [ ] **Step 3: Escrever a implementação**

`motor/backend.py`:

```python
"""
Borda com o backend do MonitoraBem.

Este tráfego NÃO passa pelo proxy residencial: o proxy existe só para a Apple,
que barra IP de datacenter. Daí o `trust_env=False` — sem ele, as variáveis de
proxy que o cliente da Apple define no processo vazariam para cá.

Os três tipos de erro existem porque cada um pede uma reação diferente:
permanente sai da fila, transitório fica, e credencial precisa de gente.
"""
import httpx

TIMEOUT_S = 30.0


class ErroPermanente(Exception):
    """O backend rejeitou o conteúdo (4xx que não é 408/429). Repetir não muda
    o resultado — o item precisa sair da fila, senão trava tudo atrás dele."""


class ErroTransitorio(Exception):
    """Pode se resolver sozinho: backend fora do ar, timeout, rede, 408 ou 429.
    O item continua na fila e vai de novo no próximo ciclo."""


class ErroDeCredencial(Exception):
    """O backend recusou a chave de serviço (401/403). Tentar de novo em 30
    minutos não resolve nada até alguém trocar a chave — por isso é um tipo
    próprio, e não mais um 'ciclo falhou' indistinguível no log."""


class ClienteBackend:
    def __init__(self, base_url: str, api_key: str, transporte=None):
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"X-Motor-Key": api_key},
            timeout=TIMEOUT_S,
            trust_env=False,
            transport=transporte,
        )

    def plano(self) -> list[dict]:
        try:
            resposta = self._http.get("/interno/motor/plano")
            resposta.raise_for_status()
        except httpx.HTTPStatusError as erro:
            if erro.response.status_code in (401, 403):
                raise ErroDeCredencial(
                    f"backend recusou a chave ao buscar o plano "
                    f"(HTTP {erro.response.status_code})"
                ) from erro
            raise ErroTransitorio(f"falha ao buscar o plano: {erro}") from erro
        except httpx.HTTPError as erro:
            raise ErroTransitorio(f"falha de rede ao buscar o plano: {erro}") from erro

        return resposta.json().get("tags", [])

    def enviar_lote(self, avistamentos: list[dict]) -> dict:
        if not avistamentos:
            return {"aceitos": 0, "duplicados": 0}

        try:
            resposta = self._http.post(
                "/interno/motor/avistamentos", json={"avistamentos": avistamentos}
            )
            resposta.raise_for_status()
        except httpx.HTTPStatusError as erro:
            status = erro.response.status_code
            if status in (401, 403):
                raise ErroDeCredencial(
                    f"backend recusou a chave ao enviar (HTTP {status})"
                ) from erro
            if 400 <= status < 500 and status not in (408, 429):
                raise ErroPermanente(
                    f"backend rejeitou o lote (HTTP {status})"
                ) from erro
            raise ErroTransitorio(f"falha temporária ao enviar (HTTP {status})") from erro
        except httpx.HTTPError as erro:
            raise ErroTransitorio(f"falha de rede ao enviar: {erro}") from erro

        return resposta.json()
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_backend.py -v`
Expected: PASS — 12 testes

- [ ] **Step 5: Commit**

```bash
git add motor/backend.py tests/test_backend.py
git commit -m "feat(motor): cliente do backend com entrega em lote e erros tipados"
```

---

# Task 9: Borda com a Apple, com proxy imposto no processo

A biblioteca FindMy.py não expõe forma de configurar proxy, e o aiohttp que ela usa internamente ignora as variáveis de ambiente. Sem o remendo abaixo a consulta sai pelo IP do servidor e a Apple devolve lista vazia sem erro. O código de origem é `21 - RASTREAMENTO/ktag-findmy-worker/findmy_worker/apple_client.py`.

**Files:**
- Create: `motor/apple.py`
- Test: `tests/test_apple.py`

**Interfaces:**
- Consumes: `Conta` de `motor/contas.py`.
- Produces: `class ProxyAusente(RuntimeError)`, `class FalhaNaApple(RuntimeError)`.
- Produces: `instalar_proxy(proxy: str) -> None`.
- Produces: `class ClienteApple` com `__init__(conta: Conta, proxy: str, anisette_url: str, buscador=None)` e `buscar(hashed_adv_keys: list[str], horas: int) -> list[dict]`, devolvendo dicionários com `id` (hashedAdvKey) e `payload` (base64 cifrado).

- [ ] **Step 1: Escrever o teste que falha**

O `buscador` injetável existe para que o teste rode sem Apple, sem rede e sem a lib instalada. É a costura que torna esta borda testável.

`tests/test_apple.py`:

```python
import pytest

from motor.apple import ClienteApple, FalhaNaApple, ProxyAusente
from motor.contas import Conta

CONTA = Conta(nome="conta-a", apple_id="a@x.com", sessao_path="/tmp/a.json")
PROXY = "http://usuario:senha@proxy.exemplo:8080"


def test_sem_proxy_recusa_ser_criado():
    with pytest.raises(ProxyAusente):
        ClienteApple(CONTA, "", "http://anisette:6969", buscador=lambda *a: [])


def test_proxy_em_branco_conta_como_ausente():
    with pytest.raises(ProxyAusente):
        ClienteApple(CONTA, "   ", "http://anisette:6969", buscador=lambda *a: [])


def test_busca_devolve_os_relatorios():
    def buscador(chaves, horas):
        return [{"id": chaves[0], "payload": "cifrado"}]

    cliente = ClienteApple(CONTA, PROXY, "http://anisette:6969", buscador=buscador)
    assert cliente.buscar(["hash-1"], 1) == [{"id": "hash-1", "payload": "cifrado"}]


def test_sem_chave_nao_bate_na_apple():
    def buscador(chaves, horas):
        raise AssertionError("nao deveria ter consultado a Apple")

    cliente = ClienteApple(CONTA, PROXY, "http://anisette:6969", buscador=buscador)
    assert cliente.buscar([], 1) == []


def test_relatorio_sem_id_ou_payload_e_descartado():
    def buscador(chaves, horas):
        return [
            {"id": "hash-1", "payload": "ok"},
            {"id": "hash-2"},
            {"payload": "sem id"},
        ]

    cliente = ClienteApple(CONTA, PROXY, "http://anisette:6969", buscador=buscador)
    assert cliente.buscar(["hash-1", "hash-2"], 1) == [{"id": "hash-1", "payload": "ok"}]


def test_falha_da_apple_vira_falha_na_apple():
    def buscador(chaves, horas):
        raise RuntimeError("401 da Apple")

    cliente = ClienteApple(CONTA, PROXY, "http://anisette:6969", buscador=buscador)
    with pytest.raises(FalhaNaApple) as erro:
        cliente.buscar(["hash-1"], 1)
    assert "conta-a" in str(erro.value)


def test_a_mensagem_de_erro_nao_vaza_a_chave_privada():
    def buscador(chaves, horas):
        raise RuntimeError("falhou")

    cliente = ClienteApple(CONTA, PROXY, "http://anisette:6969", buscador=buscador)
    with pytest.raises(FalhaNaApple) as erro:
        cliente.buscar(["hash-1"], 1)
    assert "privateKey" not in str(erro.value)
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_apple.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.apple'`

- [ ] **Step 3: Escrever a implementação**

`motor/apple.py`:

```python
"""
Borda com a rede Find My.

A Apple bloqueia consulta vinda de datacenter. Sem proxy o login devolve 200 OK
e a busca devolve lista vazia — indistinguível de "ninguém viu a TAG". Por isso
este cliente se recusa a existir sem proxy: é melhor não consultar do que
consultar e acreditar na resposta.

A FindMy.py não expõe forma pública de configurar proxy. A sessão aiohttp é
criada internamente sem `trust_env`, e o padrão do aiohttp é ignorar
HTTP_PROXY/HTTPS_PROXY do ambiente. O remendo em `instalar_proxy` é o único
jeito de forçar o proxy a ser usado de fato — e ele aborta alto se a biblioteca
mudar de estrutura, porque seguir sem proxy é o pior desfecho possível.
"""
import importlib
import inspect
import logging
import os

from motor.contas import Conta

log = logging.getLogger(__name__)


class ProxyAusente(RuntimeError):
    """Tentaram consultar a Apple sem proxy residencial."""


class FalhaNaApple(RuntimeError):
    """A consulta não completou."""


def instalar_proxy(proxy: str) -> None:
    try:
        modulo_http = importlib.import_module("findmy.util.http")
    except ImportError as erro:
        raise RuntimeError(
            "findmy.util.http não existe mais — a FindMy.py mudou de estrutura. "
            "Consultar agora sairia pelo IP do servidor e devolveria lista vazia "
            "em silêncio. Corrigir este remendo antes de continuar."
        ) from erro

    sessao = getattr(getattr(modulo_http, "HttpSession", None), "_get_session", None)
    if sessao is None:
        raise RuntimeError(
            "findmy.util.http.HttpSession._get_session sumiu — a FindMy.py mudou "
            "de versão. Consultar agora sairia pelo IP do servidor e devolveria "
            "lista vazia em silêncio. Corrigir este remendo antes de continuar."
        )

    if getattr(sessao, "_proxy_instalado", False):
        return

    os.environ["HTTPS_PROXY"] = proxy
    os.environ["HTTP_PROXY"] = proxy

    if inspect.iscoroutinefunction(sessao):

        async def com_proxy(self):
            aberta = await sessao(self)
            aberta._trust_env = True
            return aberta

    else:

        def com_proxy(self):
            aberta = sessao(self)
            aberta._trust_env = True
            return aberta

    com_proxy._proxy_instalado = True
    modulo_http.HttpSession._get_session = com_proxy


class ClienteApple:
    def __init__(self, conta: Conta, proxy: str, anisette_url: str, buscador=None):
        if not (proxy or "").strip():
            raise ProxyAusente(
                f"conta {conta.nome} sem proxy residencial — a Apple devolveria "
                "lista vazia sem erro e a frota pareceria silenciosa"
            )
        self._conta = conta
        self._proxy = proxy
        self._anisette_url = anisette_url
        self._buscador = buscador

    def buscar(self, hashed_adv_keys: list[str], horas: int) -> list[dict]:
        if not hashed_adv_keys:
            return []

        buscador = self._buscador or self._buscador_real()
        try:
            relatorios = buscador(hashed_adv_keys, horas)
        except Exception as erro:
            raise FalhaNaApple(
                f"consulta pela conta {self._conta.nome} falhou: {erro}"
            ) from erro

        return [r for r in relatorios if r.get("id") and r.get("payload")]

    def _buscador_real(self):
        """Só entra em cena em produção. A sessão da conta tem que existir em
        disco: o login é manual, feito uma vez, porque a Apple exige 2FA num
        aparelho de verdade."""
        instalar_proxy(self._proxy)

        def buscar(chaves: list[str], horas: int) -> list[dict]:
            from motor.sessao_apple import buscar_relatorios

            return buscar_relatorios(
                conta=self._conta,
                anisette_url=self._anisette_url,
                hashed_adv_keys=chaves,
                horas=horas,
            )

        return buscar
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_apple.py -v`
Expected: PASS — 7 testes

- [ ] **Step 5: Commit**

```bash
git add motor/apple.py tests/test_apple.py
git commit -m "feat(motor): borda com a Apple que se recusa a consultar sem proxy"
```

---

# Task 10: A sessão real da conta Apple

Este é o único módulo que fala com a biblioteca de verdade. Fica isolado justamente porque não dá para testá-lo sem conta real — o resto do motor não depende dele.

**Files:**
- Create: `motor/sessao_apple.py`
- Create: `scripts/login_apple.py`
- Test: `tests/test_sessao_apple.py`

**Interfaces:**
- Consumes: `Conta` de `motor/contas.py`.
- Produces: `buscar_relatorios(conta: Conta, anisette_url: str, hashed_adv_keys: list[str], horas: int) -> list[dict]`.
- Produces: `class SessaoAusente(RuntimeError)`.

- [ ] **Step 1: Escrever o teste que falha**

Testa só o que dá para testar sem conta: que a ausência de sessão é detectada antes de qualquer ida à rede.

`tests/test_sessao_apple.py`:

```python
import pytest

from motor.contas import Conta
from motor.sessao_apple import SessaoAusente, buscar_relatorios


def test_sem_arquivo_de_sessao_avisa_antes_de_ir_na_rede(tmp_path):
    conta = Conta(
        nome="conta-a",
        apple_id="a@x.com",
        sessao_path=str(tmp_path / "nao-existe.json"),
    )
    with pytest.raises(SessaoAusente) as erro:
        buscar_relatorios(conta, "http://anisette:6969", ["hash-1"], 1)
    assert "conta-a" in str(erro.value)


def test_sessao_ilegivel_tambem_avisa(tmp_path):
    caminho = tmp_path / "sessao.json"
    caminho.write_text("{ isso nao e json", encoding="utf-8")
    conta = Conta(nome="conta-a", apple_id="a@x.com", sessao_path=str(caminho))

    with pytest.raises(SessaoAusente):
        buscar_relatorios(conta, "http://anisette:6969", ["hash-1"], 1)
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_sessao_apple.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.sessao_apple'`

- [ ] **Step 3: Escrever a implementação**

`motor/sessao_apple.py`:

```python
"""
A conversa real com a Apple, isolada num módulo só.

O login é manual e acontece uma vez por conta, pelo `scripts/login_apple.py`.
Dois motivos: o 2FA chega num aparelho de verdade, e a Apple limita quantos
"dispositivos" ficam registrados numa conta — logar a cada ciclo estoura esse
limite e derruba a conta inteira.

Este módulo nunca tenta reautenticar sozinho. Se a sessão sumiu, ele avisa alto
e para; consertar é trabalho de gente.
"""
import json
from pathlib import Path

from motor.contas import Conta


class SessaoAusente(RuntimeError):
    """A sessão gravada da conta não existe ou não abre."""


def _carregar_sessao(conta: Conta) -> dict:
    caminho = Path(conta.sessao_path)
    if not caminho.exists():
        raise SessaoAusente(
            f"conta {conta.nome} sem sessão em {conta.sessao_path} — "
            "rode scripts/login_apple.py uma vez para essa conta"
        )
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as erro:
        raise SessaoAusente(
            f"sessão da conta {conta.nome} não abre ({erro}) — "
            "rode scripts/login_apple.py de novo"
        ) from erro


def buscar_relatorios(
    conta: Conta, anisette_url: str, hashed_adv_keys: list[str], horas: int
) -> list[dict]:
    from findmy import KeyPair
    from findmy.reports import AppleAccount, RemoteAnisetteProvider

    estado = _carregar_sessao(conta)

    sessao = AppleAccount(RemoteAnisetteProvider(anisette_url))
    sessao.restore(estado)

    chaves = [KeyPair.from_b64(k) for k in hashed_adv_keys]
    bruto = sessao.fetch_last_reports(chaves, hours=horas)

    return [
        {"id": relatorio.hashed_adv_key_b64, "payload": relatorio.payload_b64}
        for relatorio in bruto
    ]
```

`scripts/login_apple.py`:

```python
"""
Login manual de uma conta Apple. Rodar uma vez por conta.

    python scripts/login_apple.py conta-a a@exemplo.com /app/sessoes/a.json

O código de confirmação chega num aparelho Apple de verdade vinculado à conta.
A conta precisa já ter passado por um iPhone real antes: contas que nunca foram
usadas num aparelho são recusadas na hora de devolver dados de Find My.
"""
import json
import sys
from getpass import getpass
from pathlib import Path

from findmy.reports import AppleAccount, RemoteAnisetteProvider

from motor.apple import instalar_proxy


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit(
            "uso: python scripts/login_apple.py <nome> <apple-id> <caminho-da-sessao>"
        )

    _, nome, apple_id, destino = sys.argv

    proxy = input("proxy residencial (http://usuario:senha@host:porta): ").strip()
    if not proxy:
        raise SystemExit("sem proxy o login sai pelo IP do servidor. Abortado.")
    instalar_proxy(proxy)

    anisette = input("anisette [http://localhost:6969]: ").strip() or "http://localhost:6969"

    conta = AppleAccount(RemoteAnisetteProvider(anisette))
    conta.login(apple_id, getpass("senha: "))

    codigo = input("código de 2 fatores que chegou no aparelho: ").strip()
    conta.verify_2fa(codigo)

    caminho = Path(destino)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(conta.export()), encoding="utf-8")
    print(f"sessão da conta {nome} gravada em {destino}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_sessao_apple.py -v`
Expected: PASS — 2 testes

- [ ] **Step 5: Conferir a API real da biblioteca antes de confiar**

O `sessao_apple.py` chama `restore`, `fetch_last_reports`, `export`, `KeyPair.from_b64`, `hashed_adv_key_b64` e `payload_b64`. Confirme que existem na versão pinada:

```bash
pip download --no-deps findmy==0.10.1 -d /tmp/findmy-wheel
cd /tmp/findmy-wheel && unzip -o findmy-*.whl -d conteudo
grep -rn "def restore\|def export\|def fetch_last_reports\|def from_b64\|hashed_adv_key_b64\|payload_b64" conteudo/findmy/
```

Expected: cada nome aparece pelo menos uma vez. Qualquer um que não aparecer precisa ser corrigido em `sessao_apple.py` **antes** do commit — e o nome correto, anotado no topo do arquivo.

- [ ] **Step 6: Commit**

```bash
git add motor/sessao_apple.py scripts/login_apple.py tests/test_sessao_apple.py
git commit -m "feat(motor): sessao Apple isolada e script de login manual"
```

---

# Task 11: O ciclo completo

Junta tudo: pega o plano, distribui entre as contas, consulta em lotes, decifra, guarda na fila e entrega. Testado ponta a ponta com Apple falsa e backend falso.

**Files:**
- Create: `motor/ciclo.py`
- Test: `tests/test_ciclo.py`

**Interfaces:**
- Consumes: `ClienteBackend`, `ClienteApple`, `Fila`, `Dedupe`, `ControleDeBackfill`, `Saude`, `carregar_contas`, `distribuir`, `fatiar`, `abrir_relatorio`.
- Produces: `@dataclass class Resultado` com `consultadas: int`, `decifrados: int`, `entregues: int`, `em_fila: int`, `contas_fora: list[str]`.
- Produces: `class Ciclo` com `__init__(backend, fila, contas, criar_cliente_apple, saude=None, dedupe=None, backfill=None)` e `rodar() -> Resultado`.
- `criar_cliente_apple` é uma função `(Conta) -> ClienteApple`, injetada para o teste poder substituir a Apple inteira.

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_ciclo.py`:

```python
import httpx
import pytest

from motor.backend import ClienteBackend
from motor.ciclo import Ciclo
from motor.contas import Conta
from motor.fila import Fila

CONTAS = [
    Conta(nome="conta-a", apple_id="a@x.com", sessao_path="/a.json"),
    Conta(nome="conta-b", apple_id="b@x.com", sessao_path="/b.json"),
]

TAG = {
    "tagId": "t1",
    "hashedAdvKey": "hash-1",
    "privateKey": "priv-1",
    "backfillHours": 1,
}

ABERTO = {
    "lat": -22.938804,
    "lon": -43.560138,
    "conf": 12,
    "status": 0,
    "timestamp": 1787760795,
    "isodatetime": "2026-08-29T12:04:31+00:00",
}


class AppleFalsa:
    def __init__(self, por_chave=None, erro=None):
        self._por_chave = por_chave or {}
        self._erro = erro
        self.chamadas = []

    def buscar(self, chaves, horas):
        self.chamadas.append((list(chaves), horas))
        if self._erro:
            raise self._erro
        return [
            {"id": c, "payload": self._por_chave[c]}
            for c in chaves
            if c in self._por_chave
        ]


def _backend(handler):
    return ClienteBackend(
        "https://api.monitorabem.site",
        "chave",
        transporte=httpx.MockTransport(handler),
    )


def _ciclo(tmp_path, apple, handler, monkeypatch, contas=None):
    monkeypatch.setattr("motor.ciclo.abrir_relatorio", lambda payload, priv: ABERTO)
    return Ciclo(
        backend=_backend(handler),
        fila=Fila(tmp_path / "fila"),
        contas=contas or CONTAS,
        criar_cliente_apple=lambda conta: apple,
    )


def test_ciclo_feliz_entrega_o_avistamento(tmp_path, monkeypatch):
    enviados = []

    def handler(request):
        if request.url.path == "/interno/motor/plano":
            return httpx.Response(200, json={"tags": [TAG]})
        enviados.append(request.read().decode())
        return httpx.Response(200, json={"aceitos": 1, "duplicados": 0})

    apple = AppleFalsa(por_chave={"hash-1": "cifrado"})
    resultado = _ciclo(tmp_path, apple, handler, monkeypatch).rodar()

    assert resultado.consultadas == 1
    assert resultado.decifrados == 1
    assert resultado.entregues == 1
    assert resultado.em_fila == 0
    assert "t1" in enviados[0]


def test_plano_vazio_nao_consulta_a_apple(tmp_path, monkeypatch):
    def handler(request):
        return httpx.Response(200, json={"tags": []})

    apple = AppleFalsa()
    resultado = _ciclo(tmp_path, apple, handler, monkeypatch).rodar()

    assert apple.chamadas == []
    assert resultado.consultadas == 0


def test_backend_fora_do_ar_deixa_o_avistamento_na_fila(tmp_path, monkeypatch):
    def handler(request):
        if request.url.path == "/interno/motor/plano":
            return httpx.Response(200, json={"tags": [TAG]})
        return httpx.Response(503, text="fora do ar")

    apple = AppleFalsa(por_chave={"hash-1": "cifrado"})
    ciclo = _ciclo(tmp_path, apple, handler, monkeypatch)
    resultado = ciclo.rodar()

    assert resultado.entregues == 0
    assert resultado.em_fila == 1
    assert len(Fila(tmp_path / "fila").pendentes()) == 1


def test_o_que_ficou_na_fila_e_entregue_no_ciclo_seguinte(tmp_path, monkeypatch):
    estado = {"cair": True}
    entregues = []

    def handler(request):
        if request.url.path == "/interno/motor/plano":
            return httpx.Response(200, json={"tags": [TAG]})
        if estado["cair"]:
            return httpx.Response(503, text="fora do ar")
        entregues.append(request.read().decode())
        return httpx.Response(200, json={"aceitos": 1, "duplicados": 0})

    apple = AppleFalsa(por_chave={"hash-1": "cifrado"})
    ciclo = _ciclo(tmp_path, apple, handler, monkeypatch)
    ciclo.rodar()

    estado["cair"] = False
    resultado = ciclo.rodar()

    assert resultado.entregues >= 1
    assert Fila(tmp_path / "fila").pendentes() == []


def test_rejeicao_definitiva_vai_para_quarentena(tmp_path, monkeypatch):
    def handler(request):
        if request.url.path == "/interno/motor/plano":
            return httpx.Response(200, json={"tags": [TAG]})
        return httpx.Response(422, json={"message": "coordenada invalida"})

    apple = AppleFalsa(por_chave={"hash-1": "cifrado"})
    _ciclo(tmp_path, apple, handler, monkeypatch).rodar()

    fila = Fila(tmp_path / "fila")
    assert fila.pendentes() == []
    assert len(fila.quarentenados()) == 1


def test_falha_da_apple_nao_derruba_o_ciclo(tmp_path, monkeypatch):
    def handler(request):
        if request.url.path == "/interno/motor/plano":
            return httpx.Response(200, json={"tags": [TAG]})
        return httpx.Response(200, json={"aceitos": 0, "duplicados": 0})

    apple = AppleFalsa(erro=RuntimeError("401 da Apple"))
    resultado = _ciclo(tmp_path, apple, handler, monkeypatch).rodar()

    assert resultado.decifrados == 0
    assert resultado.contas_fora == []


def test_conta_que_falha_tres_vezes_sai_do_rodizio(tmp_path, monkeypatch):
    def handler(request):
        if request.url.path == "/interno/motor/plano":
            return httpx.Response(200, json={"tags": [TAG]})
        return httpx.Response(200, json={"aceitos": 0, "duplicados": 0})

    apple = AppleFalsa(erro=RuntimeError("401 da Apple"))
    ciclo = _ciclo(tmp_path, apple, handler, monkeypatch)
    for _ in range(3):
        ciclo.rodar()

    assert ciclo.rodar().contas_fora != []


def test_relatorio_que_nao_abre_nao_derruba_os_outros(tmp_path, monkeypatch):
    def handler(request):
        if request.url.path == "/interno/motor/plano":
            return httpx.Response(
                200,
                json={
                    "tags": [
                        TAG,
                        {
                            "tagId": "t2",
                            "hashedAdvKey": "hash-2",
                            "privateKey": "priv-2",
                            "backfillHours": 1,
                        },
                    ]
                },
            )
        return httpx.Response(200, json={"aceitos": 1, "duplicados": 0})

    def abrir(payload, priv):
        if priv == "priv-2":
            raise ValueError("nao abriu")
        return ABERTO

    monkeypatch.setattr("motor.ciclo.abrir_relatorio", abrir)

    apple = AppleFalsa(por_chave={"hash-1": "cifrado", "hash-2": "cifrado"})
    ciclo = Ciclo(
        backend=_backend(handler),
        fila=Fila(tmp_path / "fila"),
        contas=CONTAS,
        criar_cliente_apple=lambda conta: apple,
    )
    resultado = ciclo.rodar()

    assert resultado.decifrados == 1


def test_o_mesmo_avistamento_nao_e_enviado_duas_vezes(tmp_path, monkeypatch):
    envios = []

    def handler(request):
        if request.url.path == "/interno/motor/plano":
            return httpx.Response(200, json={"tags": [TAG]})
        envios.append(request.read().decode())
        return httpx.Response(200, json={"aceitos": 1, "duplicados": 0})

    apple = AppleFalsa(por_chave={"hash-1": "cifrado"})
    ciclo = _ciclo(tmp_path, apple, handler, monkeypatch)
    ciclo.rodar()
    ciclo.rodar()

    assert len(envios) == 1


def test_a_chave_privada_nunca_aparece_no_que_e_enviado(tmp_path, monkeypatch):
    envios = []

    def handler(request):
        if request.url.path == "/interno/motor/plano":
            return httpx.Response(200, json={"tags": [TAG]})
        envios.append(request.read().decode())
        return httpx.Response(200, json={"aceitos": 1, "duplicados": 0})

    apple = AppleFalsa(por_chave={"hash-1": "cifrado"})
    _ciclo(tmp_path, apple, handler, monkeypatch).rodar()

    assert "priv-1" not in envios[0]
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_ciclo.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.ciclo'`

- [ ] **Step 3: Escrever a implementação**

`motor/ciclo.py`:

```python
"""
Um ciclo do motor, do começo ao fim.

  plano → distribui entre as contas → consulta em lotes de 256 → decifra →
  grava na fila → entrega o que a fila tiver.

A ordem importa: **grava na fila antes de tentar entregar**. Se a entrega falhar
depois disso, a posição já está em disco. O contrário perderia dado numa queda.
"""
import logging
from dataclasses import dataclass, field

from motor.apple import FalhaNaApple
from motor.backend import ErroDeCredencial, ErroPermanente, ErroTransitorio
from motor.cripto import abrir_relatorio
from motor.lotes import fatiar
from motor.contas import distribuir
from motor.memoria import ControleDeBackfill, Dedupe
from motor.saude import Saude

log = logging.getLogger(__name__)

TAMANHO_DO_LOTE_DE_ENTREGA = 500


@dataclass
class Resultado:
    consultadas: int = 0
    decifrados: int = 0
    entregues: int = 0
    em_fila: int = 0
    contas_fora: list = field(default_factory=list)


class Ciclo:
    def __init__(
        self,
        backend,
        fila,
        contas,
        criar_cliente_apple,
        saude=None,
        dedupe=None,
        backfill=None,
    ):
        self._backend = backend
        self._fila = fila
        self._contas = contas
        self._criar_cliente_apple = criar_cliente_apple
        self._saude = saude or Saude()
        self._dedupe = dedupe or Dedupe()
        self._backfill = backfill or ControleDeBackfill()

    def rodar(self) -> Resultado:
        resultado = Resultado()

        tags = self._backend.plano()
        resultado.consultadas = len(tags)
        if tags:
            self._coletar(tags, resultado)

        self._entregar(resultado)

        resultado.contas_fora = [
            c.nome for c in self._contas if not self._saude.esta_saudavel(c.nome)
        ]
        resultado.em_fila = len(self._fila.pendentes())
        return resultado

    def _coletar(self, tags: list[dict], resultado: Resultado) -> None:
        por_chave = {t["hashedAdvKey"]: t for t in tags if t.get("hashedAdvKey")}
        horas = max(1, self._backfill.horas_para_o_ciclo(tags))

        contas = self._saude.saudaveis(self._contas)
        if not contas:
            log.error("nenhuma conta Apple saudável — nada será consultado neste ciclo")
            return

        mapa = distribuir(list(por_chave.keys()), contas)
        vistos_com_relatorio = set()

        for conta in contas:
            chaves = mapa.get(conta.nome, [])
            if not chaves:
                continue

            cliente = self._criar_cliente_apple(conta)
            for lote in fatiar(chaves):
                try:
                    relatorios = cliente.buscar(lote, horas)
                except Exception as erro:
                    # Uma conta quebrada não pode levar as outras junto.
                    # `FalhaNaApple` é o caso esperado; qualquer outra exceção
                    # daqui também é falha desta conta, e não do ciclo inteiro.
                    self._saude.registrar_falha(conta.nome, str(erro))
                    log.warning("conta %s falhou: %s", conta.nome, erro)
                    break
                self._saude.registrar_sucesso(conta.nome)

                for relatorio in relatorios:
                    tag = por_chave.get(relatorio["id"])
                    if not tag:
                        continue
                    vistos_com_relatorio.add(relatorio["id"])
                    if self._guardar(relatorio, tag):
                        resultado.decifrados += 1

        self._backfill.atualizar(tags, vistos_com_relatorio)

    def _guardar(self, relatorio: dict, tag: dict) -> bool:
        try:
            aberto = abrir_relatorio(relatorio["payload"], tag["privateKey"])
        except Exception as erro:
            # Chave errada numa TAG não pode derrubar a coleta das outras.
            # A mensagem cita a TAG pelo id, nunca pela chave privada.
            log.warning("relatório da TAG %s não abriu: %s", tag["tagId"], erro)
            return False

        avistamento = {
            "tagId": tag["tagId"],
            "hashedAdvKey": relatorio["id"],
            "vistoEm": aberto["isodatetime"],
            "lat": aberto["lat"],
            "lng": aberto["lon"],
            "precisaoM": int(aberto["conf"]),
        }

        if self._dedupe.ja_enviado(avistamento):
            return False

        self._fila.guardar(avistamento)
        return True

    def _entregar(self, resultado: Resultado) -> None:
        pendentes = self._fila.pendentes()
        if not pendentes:
            return

        for grupo in fatiar(pendentes, TAMANHO_DO_LOTE_DE_ENTREGA):
            corpo = [payload for _, payload in grupo]
            try:
                self._backend.enviar_lote(corpo)
            except ErroPermanente as erro:
                for caminho, _ in grupo:
                    self._fila.quarentenar(caminho, str(erro))
                continue
            except ErroDeCredencial as erro:
                log.error("CHAVE DE SERVIÇO RECUSADA — nada será entregue: %s", erro)
                return
            except ErroTransitorio as erro:
                log.warning("entrega adiada, os itens seguem na fila: %s", erro)
                return

            for caminho, payload in grupo:
                self._dedupe.marcar(payload)
                self._fila.remover(caminho)
            resultado.entregues += len(grupo)
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_ciclo.py -v`
Expected: PASS — 10 testes

- [ ] **Step 5: Rodar a suíte inteira**

Run: `python -m pytest -q`
Expected: PASS — 84 testes (8 config + 2 cripto + 6 lotes + 10 contas + 8 saúde + 11 memória + 8 fila + 12 backend + 7 apple + 2 sessão + 10 ciclo)

- [ ] **Step 6: Commit**

```bash
git add motor/ciclo.py tests/test_ciclo.py
git commit -m "feat(motor): ciclo completo com fila antes da entrega"
```

---

# Task 12: O laço, o container e o primeiro teste com TAG real

**Files:**
- Create: `motor/worker.py`
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `contas.exemplo.json`
- Create: `README.md`
- Test: `tests/test_worker.py`

**Interfaces:**
- Consumes: `carregar_config`, `carregar_contas`, `ClienteBackend`, `ClienteApple`, `Fila`, `Ciclo`.
- Produces: `montar(ambiente: dict, contas_bruto: list[dict]) -> Ciclo`.
- Produces: `main() -> None`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/test_worker.py`:

```python
import pytest

from motor.config import INTERVALO_MINIMO_S, ConfiguracaoInvalida, carregar_config
from motor.worker import montar

AMBIENTE = {
    "API_BASE_URL": "https://api.monitorabem.site",
    "MOTOR_API_KEY": "chave",
    "APPLE_PROXY": "http://usuario:senha@proxy.exemplo:8080",
    "ANISETTE_URL": "http://anisette:6969",
    "INTERVALO_S": "60",
}

CONTAS = [{"nome": "conta-a", "appleId": "a@x.com", "sessaoPath": "/tmp/a.json"}]


def test_monta_o_ciclo_com_o_ambiente_completo(tmp_path):
    ciclo = montar({**AMBIENTE, "FILA_PATH": str(tmp_path / "fila")}, CONTAS)
    assert ciclo is not None


def test_nao_monta_sem_proxy(tmp_path):
    ambiente = {k: v for k, v in AMBIENTE.items() if k != "APPLE_PROXY"}
    with pytest.raises(ConfiguracaoInvalida):
        montar({**ambiente, "FILA_PATH": str(tmp_path / "fila")}, CONTAS)


def test_o_intervalo_configurado_abaixo_do_piso_e_elevado():
    assert carregar_config(AMBIENTE).intervalo_s == INTERVALO_MINIMO_S
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `python -m pytest tests/test_worker.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.worker'`

- [ ] **Step 3: Escrever a implementação**

`motor/worker.py`:

```python
"""
O laço do motor.

Piso de 30 minutos: consultar mais rápido bane a conta Apple, e como o atraso
da própria rede Find My é de 8 a 47 minutos, consultar mais rápido também não
traria posição mais nova. Configurar menos não funciona — o valor é elevado na
configuração.
"""
import json
import logging
import os
import time
from pathlib import Path

from motor.apple import ClienteApple
from motor.backend import ClienteBackend
from motor.ciclo import Ciclo
from motor.config import carregar_config
from motor.contas import carregar_contas
from motor.fila import Fila

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("motor")


def montar(ambiente: dict, contas_bruto: list[dict]) -> Ciclo:
    cfg = carregar_config(ambiente)
    contas = carregar_contas(contas_bruto)

    return Ciclo(
        backend=ClienteBackend(cfg.api_base, cfg.api_key),
        fila=Fila(cfg.fila_path),
        contas=contas,
        criar_cliente_apple=lambda conta: ClienteApple(
            conta, cfg.apple_proxy, cfg.anisette_url
        ),
    )


def main() -> None:
    cfg = carregar_config(dict(os.environ))
    contas_bruto = json.loads(Path(cfg.contas_path).read_text(encoding="utf-8"))
    ciclo = montar(dict(os.environ), contas_bruto)

    log.info(
        "motor no ar: api=%s contas=%d intervalo=%ds",
        cfg.api_base,
        len(contas_bruto),
        cfg.intervalo_s,
    )

    while True:
        try:
            r = ciclo.rodar()
            log.info(
                "ciclo: %d TAG(s) no plano, %d decifrado(s), %d entregue(s), "
                "%d na fila, contas fora: %s",
                r.consultadas,
                r.decifrados,
                r.entregues,
                r.em_fila,
                r.contas_fora or "nenhuma",
            )
        except Exception:
            log.exception("ciclo falhou inteiro")
        time.sleep(cfg.intervalo_s)


if __name__ == "__main__":
    main()
```

`Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY motor/ ./motor/
COPY scripts/ ./scripts/

# Sem buffer: o log aparece no docker logs na hora, não quando o buffer enche.
ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "motor.worker"]
```

`docker-compose.yml`:

```yaml
services:
  # Autenticação com a Apple. Guarda estado em volume: sem ele, todo restart
  # pediria 2FA de novo — e cada login novo consome uma vaga de dispositivo na
  # conta, que é limitada.
  anisette:
    image: dadoum/anisette-v3-server:latest
    container_name: monitorabem-anisette
    restart: unless-stopped
    volumes:
      - ./data/anisette:/home/Alcoholic/.config/anisette-v3/lib/

  motor:
    build: .
    container_name: monitorabem-motor
    restart: unless-stopped
    depends_on:
      - anisette
    env_file:
      - .env
    environment:
      - ANISETTE_URL=http://anisette:6969
      - CONTAS_PATH=/app/contas.json
      - FILA_PATH=/app/fila
    volumes:
      - ./contas.json:/app/contas.json:ro
      - ./sessoes:/app/sessoes
      - ./fila:/app/fila
```

`.env.example`:

```
API_BASE_URL=https://api.monitorabem.site
MOTOR_API_KEY=troque-por-uma-chave-de-servico-de-verdade
# Sem proxy residencial o motor NAO SOBE. A Apple bloqueia IP de datacenter
# devolvendo lista vazia sem erro nenhum.
APPLE_PROXY=http://usuario:senha@proxy.exemplo:8080
INTERVALO_S=1800
LOG_LEVEL=INFO
```

`contas.exemplo.json`:

```json
[
  {
    "nome": "conta-a",
    "appleId": "conta-a@exemplo.com",
    "sessaoPath": "/app/sessoes/conta-a.json"
  }
]
```

`README.md`:

````markdown
# MonitoraBem — Motor Find My

Descobre onde cada TAG foi vista e entrega ao backend.

```
  TAG (Bluetooth)  ->  iPhone de qualquer pessoa  ->  Apple (guarda 7 dias)
                                                        |
                        motor  <---------------------- |
                          |  (busca por proxy residencial e decifra)
                          v
                  POST /interno/motor/avistamentos
```

## Três regras que não se negociam

**1. Sem proxy residencial o motor não sobe.** A Apple bloqueia consulta vinda
de datacenter devolvendo **lista vazia sem erro**, o que é indistinguível de
"ninguém viu a TAG". Subir sem proxy faria a frota inteira parecer silenciosa.

**2. Piso de 30 minutos.** Configurar menos não funciona — o valor é elevado no
código. Consultar de 5 em 5 minutos bane a conta, e a latência da rede Find My
(8 a 47 min) já é maior que o piso.

**3. Uma conta por pedaço da base.** Uma conta banida não pode derrubar todos os
clientes. A mesma TAG cai sempre na mesma conta, por hash estável.

## Subir

1. `cp .env.example .env` e preencher, inclusive o proxy.
2. `cp contas.exemplo.json contas.json` e listar as contas.
3. Login manual, **uma vez por conta** (o 2FA chega num aparelho de verdade):

```bash
docker compose up -d anisette
python scripts/login_apple.py conta-a conta-a@exemplo.com ./sessoes/conta-a.json
```

4. `docker compose up -d`

## Testes

```bash
pip install -r requirements.txt
python -m pytest -q
```
````

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `python -m pytest tests/test_worker.py -v`
Expected: PASS — 3 testes

- [ ] **Step 5: Rodar a suíte inteira**

Run: `python -m pytest -q`
Expected: PASS — 87 testes (os 84 anteriores + 3 do worker)

- [ ] **Step 6: Commit**

```bash
git add motor/worker.py Dockerfile docker-compose.yml .env.example contas.exemplo.json README.md tests/test_worker.py
git commit -m "feat(motor): laco com piso de 30 minutos, container e documentacao"
```

- [ ] **Step 7: Prova com a TAG real**

Este passo é o critério de aceitação do bloco inteiro e precisa de coisas do mundo real: uma conta Apple que já passou por um iPhone, um proxy residencial contratado e a TAG física.

A TAG de teste existe: número `92603008494`, com chave em
`21 - RASTREAMENTO/poc-ktag-findmy/keys/ktag-92603008494.json`.

Como o backend ainda não existe (bloco 2), sirva o plano com um arquivo estático:

Grave o script abaixo como `scripts/plano_de_teste.py` — ele lê o arquivo de chaves real e escreve o plano, sem ninguém precisar copiar chave à mão:

```python
"""Monta o plano de teste a partir do arquivo de chaves do fabricante."""
import json
import sys
from pathlib import Path

origem = Path(sys.argv[1])
destino = Path(sys.argv[2])

chave = json.loads(origem.read_text(encoding="utf-8"))
destino.parent.mkdir(parents=True, exist_ok=True)
destino.write_text(
    json.dumps(
        {
            "tags": [
                {
                    "tagId": "tag-de-teste",
                    "hashedAdvKey": chave["hashedAdvKey"],
                    "privateKey": chave["privateKey"],
                    "backfillHours": 24,
                }
            ]
        }
    ),
    encoding="utf-8",
)
print(f"plano escrito em {destino}")
```

E rode:

```bash
python scripts/plano_de_teste.py \
  "/c/Users/damas/Documents/PROJETOS/21 GO/21 - RASTREAMENTO/poc-ktag-findmy/keys/ktag-92603008494.json" \
  /tmp/backend-falso/interno/motor/plano
cd /tmp/backend-falso && python -m http.server 8099
```

Aponte `API_BASE_URL=http://localhost:8099` e rode um ciclo só:

```bash
python -c "import json,os; from pathlib import Path; from motor.worker import montar; \
c=json.loads(Path('contas.json').read_text()); print(montar(dict(os.environ), c).rodar())"
```

Expected: `Resultado(consultadas=1, decifrados=N, ...)` com **N maior que zero**, e a fila com os avistamentos gravados (a entrega vai falhar, porque o servidor estático não aceita POST — e é isso mesmo que prova que a fila funciona).

Se `decifrados=0` e a Apple não deu erro, o problema quase certamente é o proxy: valide que ele está de pé antes de suspeitar do código.

- [ ] **Step 8: Anotar o resultado no README**

Acrescente ao final do `README.md` a data do teste, quantos avistamentos vieram e qual foi o atraso observado entre `vistoEm` e a hora do teste. Esse número é o que a equipe de produto vai usar para escrever o texto do app — e ele precisa vir de medição, não de estimativa.

```bash
git add README.md
git commit -m "docs(motor): resultado do primeiro teste com TAG real"
```

---

## Cobertura em relação ao spec

| Requisito do spec (seção 5) | Onde é atendido |
|---|---|
| Decifragem ECDH + AES-GCM com teste de ida e volta | Task 2 |
| Fila em disco | Task 7 |
| Proxy residencial obrigatório | Task 1 (config) e Task 9 (borda com a Apple) |
| Piso de 30 minutos | Task 1 e Task 12 |
| Lotes de 256 chaves | Task 3 e Task 11 |
| Pool de contas Apple | Task 4 |
| Saúde por conta, visível | Task 5 (`Saude.resumo()`) e Task 11 (`Resultado.contas_fora`) |
| Ritmo governado pela assinatura | Backend, bloco 2. O motor obedece ao plano — Task 8 |
| Sessão persistida, login uma vez | Task 10 |
| Chave privada nunca em log nem em resposta | Task 9 e Task 11, com teste |

O ritmo por assinatura é decidido no backend e chega pronto no plano. Isso é intencional: o motor não conhece assinatura, cerca nem cliente — ele obedece.
