# ktag-findmy-worker

Worker Python isolado que busca na rede Apple Find My a posição das etiquetas
Bluetooth K-Tag instaladas em veículos e entrega essa posição ao backend
NestJS do 21 GO. Ele roda em loop: pergunta ao backend qual é o plano de
consulta (`GET /ble-tags/polling-plan`), busca na Apple, deduplica, entrega
(`POST /ble-tags/sightings`) e, se o backend estiver fora do ar, guarda em
fila local até o backend voltar.

O worker não decide nada sobre alerta, veículo ou regra de negócio — quem
decide quais TAGs importam e com que urgência é o backend. O worker só
obedece ao plano que recebe.

## Proxy residencial é obrigatório

A Apple bloqueia consultas de Find My vindas de IP de datacenter — DigitalOcean
incluída, que é onde este worker roda. Sem proxy residencial, o login retorna
`200 OK` e a busca devolve lista vazia, o que é indistinguível de "nenhuma TAG
foi vista". Por isso `AppleClient` se recusa a ser instanciado sem
`APPLE_PROXY` configurado.

## Login é manual, uma vez

O 2FA por SMS da Apple está quebrado no momento. O login é feito à mão, uma
única vez, com `--trusteddevice` (o código de confirmação chega num iPhone
real vinculado à conta). O worker nunca tenta reautenticar sozinho — ele só
restaura a sessão gravada em `APPLE_SESSION_DIR/account.json`. A conta Apple
usada também precisa já ter sido logada num iPhone de verdade antes: contas
que nunca passaram por um dispositivo real são recusadas pela Apple na hora
de devolver dados de Find My.

## Rodando os testes

```bash
cd ktag-findmy-worker
python -m pytest -q
```
