# Worker Find My — a TAG no mapa

Fecha o circuito da TAG: pergunta ao backend quais TAGs merecem consulta agora,
busca os relatórios na rede Find My da Apple, **decifra** cada um com a chave
privada da TAG e devolve as posições por `POST /ble-tags/sightings`.

Sem ele, a TAG não aparece em lugar nenhum — a tela e a análise já existem e
ficam esperando dado.

## Como as peças se encaixam

```
  TAG (Bluetooth)  ->  iPhone de qualquer pessoa  ->  Apple (guarda 7 dias)
                                                        |
   worker  <-  macless-haystack  <---------------------- |
     |          (busca, não decifra)
     |
     +-- decifra com a chave privada da TAG (findmy_crypto.py)
     +-- POST /ble-tags/sightings  ->  backend 21 GO  ->  mapa e histórico
```

A Apple **nunca** sabe onde os nossos ativos estão: ela guarda um envelope
cifrado que só a chave privada da TAG abre. É por isso que a decifragem mora
aqui e não no container do decoder.

## Duas regras que não se negociam

**1. Quem decide o que consultar é o backend.** O worker não escolhe nada: ele
pergunta a `/ble-tags/polling-plan`, que devolve **só** as TAGs em ritmo
acelerado — as que têm alerta aberto de rastreador mudo (`OFFLINE`,
`GPS_SILENT`, `JAMMING`, `POWER_CUT`) ou turbo ligado pelo operador. TAG em
repouso não custa requisição nenhuma.

**2. Piso de 30 minutos, aplicado no código.** Configurar `WORKER_INTERVAL_S`
abaixo disso não funciona — o worker ignora e usa 1800 s. Consultar de 5 em 5
minutos bane a conta Apple, e aí a trilha de **todas** as TAGs some junto. Como
a latência da própria rede é de 8 a 47 minutos, consultar mais rápido não
traria posição mais nova de qualquer forma.

> **O histórico é retroativo.** Quando uma TAG entra em ritmo acelerado, o
> `backfillHours` do plano manda buscar até 7 dias de uma vez — tudo o que a
> Apple guarda. Ou seja: no momento em que o rastreador fica mudo, o histórico
> dos últimos 7 dias daquele veículo aparece inteiro, de uma vez. É exatamente
> quando alguém precisa saber onde o carro costumava dormir.

## Subir

### 1. Chaves das TAGs

Um arquivo JSON por TAG em `keys/`, no formato que o fabricante entrega por
lote (ver a memória `reference_ktag_arquivo_de_chaves`):

```json
{
  "name": "KTAG 92603008494",
  "id": "92603008494",
  "macAddress": "0E:02:3C:02:25:EB",
  "privateKey": "<base64>",
  "hashedAdvKey": "<base64>"
}
```

As mesmas chaves precisam estar no `Device` correspondente no banco
(`ble_adv_key_private` e `ble_adv_key_hashed`) — é de lá que o
`polling-plan` as lê. O arquivo em `keys/` serve ao decoder; o banco serve ao
worker.

`keys/*.json` está no `.gitignore`. **Chave de TAG nunca entra no repositório.**

### 2. Configurar

```bash
cp .env.example .env
# preencher JWT_TOKEN com um token de usuário ADMIN ou OPERATOR do tenant
```

### 3. Subir e logar na Apple (uma vez)

```bash
docker compose up -d
```

Abrir `http://localhost:6176` e fazer o login da conta Apple dedicada
(`7growthvendas@gmail.com`), com o 2FA por SMS. O endpoint do anisette é
`http://anisette:6969`. O estado fica no volume — restart não pede login de
novo.

### 4. Conferir

```bash
docker compose logs -f worker
```

O que se espera ver a cada ciclo:

```
worker Find My no ar: API=... decoder=... intervalo=1800s
consultando 3 TAG(s), janela de 7 dia(s)
41 relatório(s) recebido(s) da rede Find My
avistamentos enviados: 41 aceitos, 0 falhos
```

`nenhuma TAG em ritmo acelerado` **não é erro**: significa que nenhuma TAG tem
ocorrência aberta agora. É o estado normal e barato.

## Testes

```bash
pip install -r requirements-dev.txt
python -m pytest -v
```

O teste de criptografia não usa mock: ele monta um relatório do jeito que um
iPhone montaria (gera chave efêmera, deriva o segredo, cifra a coordenada) e
confere que o decifrador recupera a coordenada exata. Um byte errado no
algoritmo e o teste quebra.

## Quando algo não funciona

| Sintoma | Causa provável |
|---|---|
| `nenhuma TAG em ritmo acelerado` sempre | Nenhum alerta aberto. Para forçar: `POST /ble-tags/:id/turbo` (6 h). |
| `relatório não abriu para a TAG X` | Chave privada no banco não é a daquela TAG. Conferir contra o arquivo do lote. |
| `decoder fora do ar` | Container do haystack caído, ou login da Apple expirado — reabrir `:6176`. |
| `0 relatório(s) recebido(s)` | A TAG não foi vista por ninguém na janela. Normal em área sem iPhone; TAG também só emite quando está longe do iPhone "dono" dela. |
| 401 no `POST /ble-tags/sightings` | `JWT_TOKEN` expirado ou de usuário sem role ADMIN/OPERATOR. |

## Arquivos

| Arquivo | Função |
|---|---|
| `findmy_crypto.py` | Decifra o relatório (ECDH SECP224R1 + AES-GCM). Portado de biemster/FindMy. |
| `decoder_client.py` | Fala com o endpoint Macless Haystack. |
| `worker.py` | Orquestra: plano → busca → decifra → envia. |
| `docker-compose.yml` | anisette + decoder + worker. |
