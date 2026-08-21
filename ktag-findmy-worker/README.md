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

## BACKEND_TOKEN expira em 12 horas — limitação operacional

`BACKEND_TOKEN` é um JWT de staff comum, emitido pelo login do backend com
`internalExpiration: '12h'` (`backend/src/config/configuration.ts`). O
backend não tem API key nem service account para processos automatizados —
o worker usa o mesmo token que uma pessoa usaria.

**Consequência:** passadas 12h da emissão, todo ciclo falha com HTTP 401/403
até alguém trocar o token. O worker detecta isso (`ErroDeCredencial`) e loga
um `SESSAO`/`TOKEN` de erro bem visível a cada ciclo — mas ele **fica cego**
enquanto isso: nenhuma posição nova chega ao backend, e é justamente nesse
tipo de silêncio que a TAG deveria estar cobrindo (jammer de GPS/GSM não
desliga o Bluetooth, mas um token vencido desliga o worker inteiro).

Enquanto não existir um mecanismo de credencial de longa duração no backend,
alguém precisa gerar um `BACKEND_TOKEN` novo e reimplantar o worker com ele
antes de cada expiração — ou monitorar o log de `TOKEN DO BACKEND EXPIROU`
e agir quando ele aparecer.

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
