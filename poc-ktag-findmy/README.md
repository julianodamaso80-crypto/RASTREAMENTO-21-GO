# POC — KTAG/WGPSTAG/REDETAG via Apple Find My (Macless Haystack)

Objetivo: validar se conseguimos decifrar a posição de uma TAG TrackerKing
(KTAG/WGPSTAG/REDETAG) usando o decoder open source Macless Haystack,
sem depender da plataforma concorrente REDEVEICULOS.

**Status:** isolado do projeto principal. Não impacta backend, frontend, banco ou Traccar.

---

## Pré-requisitos

- [x] Docker Desktop rodando no Windows
- [x] Apple ID dedicado: `7growthvendas@gmail.com` (senha guardada com segurança — conta "21Go marketing", criada em 2026-04-27)
- [x] Celular com SMS 2FA acessível
- [x] Chaves da TAG já preenchidas em `keys/ktag-92603008494.json`

---

## Passo a passo

### 1. Subir os containers

Na pasta `poc-ktag-findmy/`, abrir terminal (PowerShell ou Git Bash) e rodar:

```bash
docker compose up -d
```

Isso baixa duas imagens e sobe dois serviços:

- `poc-anisette` na porta `6969` (autenticação Apple)
- `poc-macless-haystack` na porta `6176` (decoder + frontend web)

Primeira execução demora ~3–5 min (baixa ~500 MB).

### 2. Verificar se subiu

```bash
docker compose ps
```

Os dois containers devem aparecer como `running`.

Testa o anisette:

```bash
curl http://localhost:6969
```

Deve retornar JSON com headers Apple. Se retornar erro, ver logs com:

```bash
docker compose logs anisette
```

### 3. Login na conta Apple

Abrir no navegador: <http://localhost:6176>

- Vai pedir Apple ID + senha (`7growthvendas@gmail.com`)
- Vai mandar código 2FA pelo SMS — digita
- Vai pedir endpoint do anisette → `http://anisette:6969`

Após login, o frontend deve listar a TAG do arquivo `keys/ktag-92603008494.json`.

### 4. Forçar busca de localização

Na interface web, clicar no botão de **Refresh** ao lado da TAG.

Resultado esperado:
- ✅ Aparece pelo menos 1 ponto no mapa com lat/lng → **POC funcionou**
- ❌ "No reports found" → TAG não emitiu BLE recentemente, levar pra rua e tentar de novo
- ❌ Erro de autenticação Apple → conta possivelmente bloqueada, criar outra

---

## O que cada arquivo faz

| Arquivo | Função |
|---|---|
| `docker-compose.yml` | Define os 2 serviços Docker |
| `keys/ktag-92603008494.json` | Chaves da TAG (PrivateKey + HashedAdvKey em base64) |
| `data/anisette/` | Estado do anisette (gerado em runtime, não commitar) |
| `data/haystack/` | Cache de relatórios decifrados (gerado em runtime, não commitar) |
| `.gitignore` | Protege as chaves e credenciais de subir pro git |

---

## Como derrubar

```bash
docker compose down
```

Pra apagar TUDO (incluindo cache e estado):

```bash
docker compose down -v
rm -rf data/
```

---

## Próximo passo se a POC der certo

1. Criar tabela `BleTag` no schema Prisma do 21 GO
2. Subir worker Macless Haystack na infra (DigitalOcean droplet separada do droplet principal)
3. Worker grava posições direto na tabela `Position` do 21 GO via API REST
4. Frontend trata BleTag como Device normal — mapa funciona igual

## Referências

- [Macless Haystack — repositório oficial](https://github.com/dchristl/macless-haystack)
- [FindMy.py — alternativa Python pura](https://github.com/malmeloo/FindMy.py)
- [Anisette V3 Server](https://github.com/Dadoum/anisette-v3-server)
