---
data: 2026-09-12
projeto: 21Go-Rastreamento
tags: [app, boletos, sga, hinova, crm, push, associado]
tipo: decisão
---

# Aba Boletos no app do associado (Android e iOS)

## Contexto

Pedido do dono, textual: *"quero colocar uma aba na parte de baixo do app Android e Apple, ao
lado de Perfil, com nome Boletos. Lá vão ficar todos os boletos que ele tem a pagar daquele
veículo. Toda vez que virar o mês e ele tiver boleto a pagar vai ficar nessa aba, que ele
consegue baixar os boletos dele. Se ele já pagou, o boleto some; se deu mais de 5 dias de
vencimento ele some porque ele não pode pagar. E também, quando gerar boleto para o cliente,
enviar notificação do tipo 'seu boleto já está disponível para pagamento'."*

O app hoje (**1.5.0**, Expo SDK 54, `com.r21go.client`) tem três abas — Mapa, Trajetos e
Perfil — e **nenhuma notificação instalada**. O associado entra por CPF/CNPJ e o backend já
serve veículos, histórico, trajetos e alertas em `/app/*`.

### Decisões que o dono tomou nesta conversa

| Pergunta | Decisão |
|---|---|
| Boletos de qual veículo | **De todos os veículos dele**, numa lista só, com a placa escrita em cada boleto |
| Como avisa | **Push no app** (sem badge, sem WhatsApp por este módulo) |
| De onde vêm os boletos | **Do CRM**, que já espelha a base e já tem as regras julgadas |
| Fim de semana / fora de hora | **Baixar o boleto na janela e deixar guardado**, para o associado pagar a qualquer hora |
| Boleto com mais de 5 dias | **Some da lista**, e fica o aviso: *"Para dúvidas e informações, fale com nosso Setor de Boletos: 📞 (21) 95933-5359 \| (21) 98142-2100"* |

## O que foi medido antes de desenhar (12/09/2026, 13h30–14h)

1. **A liberação do SGA "00h–23h todo dia" NÃO foi aplicada.** A credencial que o
   rastreamento e o CRM usam (a mesma, `Juliano Damaso`) respondeu `HTTP 200` com
   `error.mensagem: "Usuário com restrição de horário"` às 13h30 de um **sábado**. Os logs do
   container do CRM mostram o mesmo nas últimas 40 h:

   | Horário de Brasília | Recusas |
   |---|---:|
   | sexta 11/09, 20h–21h | 3.432 |
   | sábado 12/09, 09h–13h | 10.341 |

   A janela real continua sendo a antiga, **seg–sex 7h–18h**. Esta era exatamente a prova que
   ficou pendente no log de 11/09 (`2026-09-11-21GO-CRM-sga-janela-00-23`). ⚠️ Afeta o CRM
   também, que tenta carregar a rede o dia inteiro desde ontem e apanha.

2. **O CRM já espelha a base inteira de boletos.** Tabela `rede_boletos` no Supabase:
   **103.556 boletos, 16.823 em aberto**, com `nosso_numero`, `codigo_veiculo`, `placa`,
   `cpf_associado`, `data_vencimento`, `data_pagamento`, `valor`, `codigo_situacao` e
   `situacao`. Carga fresca: 13.474 boletos vencendo em 10/09 e 12.712 em 20/09.

3. **As regras finas já existem e estão testadas no CRM**, em
   `backend/src/modules/rede/boleto-ao-vivo.ts` e `modules/boletos/boleto-vivo.ts`:
   - pago = códigos **1** (BAIXADO) e **4** (BAIXADO C/ PENDÊNCIA) do catálogo do SGA, ou
     `data_pagamento` preenchida;
   - cancelado = códigos **3** e **999** — e boleto cancelado devolve, no lugar da URL, a
     **frase** "não foi possível disponibilizar esta informação";
   - o link responde **200 mesmo morto**, com HTML de erro no corpo: só o conteúdo prova;
   - **`DIAS_PARA_EMITIR = 5`** — regra do dono de 12/08/2026, status `fora_do_prazo`;
   - o PDF tem **~3,4 MB** e a emissão de segunda via expira por volta de 21 dias de atraso.

4. **207 associados** já entraram no app (de 485 cadastrados), todos nos últimos 30 dias.

5. **Disco do droplet: 145 GB de 309 GB (47%)**. Ele já chegou a 97% em 10/09 por imagens
   Docker — o novo armazenamento precisa ser medido a cada passada.

## Arquitetura

Três peças, cada uma com um trabalho só. O princípio que amarra: **o app nunca fala com o
SGA, e a regra financeira vive num lugar só (o CRM).**

```
   SGA Hinova  ──(seg–sex 7h–18h)──▶  CRM 21Go
                                        │  rede_boletos (103 mil) + regras julgadas
                                        │
                                        ▼  GET /api/integracao/boletos?cpf=…   [segredo no header]
                              backend do rastreamento
                                        │  robô 8h / 12h / 17h30: guarda linha digitável + PDF
                                        │  tabela associate_boletos + arquivos em disco
                                        ▼  GET /app/boletos          [JWT do associado]
                                   app 21 Tracker
                                   (lê só o que está guardado — funciona sábado e 23h)
```

### 1. CRM — a porta de saída

Rota nova `GET /api/integracao/boletos?cpf=<11 ou 14 dígitos>`, registrada com prefixo
`/api/integracao`, protegida por segredo em header (`Authorization: Bearer <INTEGRACAO_TOKEN>`;
o padrão de segredo compartilhado já existe no webhook do Power). Devolve os boletos **em
aberto** daquele CPF, já classificados pelas funções existentes — nada de regra nova:

```jsonc
{
  "boletos": [
    {
      "nossoNumero": "123456789",
      "placa": "RJU0F75",
      "mesReferente": "09/2026",
      "valor": 250.57,
      "vencimento": "2026-09-20",
      "status": "disponivel",          // disponivel | pago | cancelado | expirado | fora_do_prazo
      "linhaDigitavel": "23793.38128 …",
      "linkPdf": "https://…"           // só quando status === "disponivel"
    }
  ]
}
```

Quando o SGA estiver fora da janela, a rota responde o que o espelho sabe (valor, vencimento,
situação) com `linhaDigitavel: null` e `linkPdf: null` — **nunca** inventa e nunca falha a
chamada inteira por causa disso.

### 2. Rastreamento — o robô e o espelho local

**Tabela `associate_boletos`** (migration aditiva):

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid | |
| `tenant_id` | uuid | regra 1 do projeto: toda query filtra por tenant |
| `associate_id` | uuid | dono do boleto |
| `nosso_numero` | text | **UNIQUE (tenant_id, nosso_numero)** — chave de idempotência |
| `plate` | text | escrita no cartão |
| `mes_referente`, `valor`, `vencimento`, `status` | | espelho do que o CRM julgou |
| `linha_digitavel` | text | null enquanto o SGA não tiver respondido |
| `pdf_bytes` | int | tamanho do arquivo guardado; null se ainda não baixou |
| `avisado_em` | timestamptz | trava do push: uma vez por boleto, para sempre |
| `atualizado_em` | timestamptz | |

**Onde o PDF fica guardado: no Postgres, não em arquivo.** Medido em 12/09 — o serviço
`backend-rastreamento` **não tem nenhum volume montado** (`Mounts: null`), então arquivo escrito
dentro do container morre no próximo deploy. O Postgres, ao contrário, grava num bind mount
persistente (`/etc/easypanel/projects/rastreamento-21-go/postgres-rastreamento/data`). O PDF vai
como `bytea` numa tabela à parte, `associate_boleto_pdfs` (`nosso_numero`, `conteudo`,
`baixado_em`), separada da tabela principal para não pesar as consultas da lista e para apagar
sem tocar no resto. Custo: ~850 MB sobre os 7,1 GB do banco hoje. A alternativa — montar volume
no serviço — exigiria mexer na configuração de build do EasyPanel, que é exatamente o risco que
a regra 0 manda não correr sem necessidade.

**Robô (`@nestjs/schedule`), 8h / 12h / 17h30, seg–sex**, com guarda de janela própria (se o
SGA recusar por horário, registra e sai — não fica martelando como o CRM está fazendo):

1. lista os associados com `last_login_at` não nulo (207 hoje);
2. para cada um, pergunta ao CRM;
3. grava/atualiza as linhas por `nosso_numero`;
4. baixa o PDF de quem está `disponivel` e ainda não tem o arquivo guardado;
5. **apaga o PDF e a linha** de boleto pago ou com mais de 5 dias do vencimento;
6. loga quantos PDFs e quantos MB estão guardados.

**Endpoints do app** (guard do associado, já existente):

- `GET /app/boletos` — lê **só** do espelho local. Devolve os boletos em aberto de todos os
  veículos do associado, ordenados por vencimento. Nunca chama SGA nem CRM na hora.
- `GET /app/boletos/:id/pdf` — devolve o PDF guardado no banco, conferindo que o boleto é do
  associado do token.
- `POST /app/devices` — registra o token de push do aparelho.

**Primeiro acesso de quem o robô ainda não conhece:** se for dentro da janela, busca na hora e
guarda; fora dela, a aba responde `pendente` e o app escreve *"Seus boletos aparecem aqui a
partir de segunda-feira."*

### 3. App — a aba

Aba **Boletos** entre Trajetos e Perfil, ícone de documento. Cartão por boleto: apelido e placa
do veículo, mês de referência, valor, vencimento em linguagem humana ("vence em 8 dias",
"vence hoje", "venceu há 2 dias" em vermelho), e dois botões: **Copiar código** (`expo-clipboard`)
e **Baixar boleto** (abre a URL do PDF). Rodapé fixo, sempre visível:

> Para dúvidas e informações, fale com nosso Setor de Boletos:
> 📞 (21) 95933-5359 | (21) 98142-2100

Estado vazio: *"Você está em dia. Nenhum boleto em aberto."* mais o rodapé.

Sem badge na aba (decisão do dono). Sem IMEI, servidor, TAG ou qualquer campo interno — vale a
regra 0 do projeto, com teste de contrato "envenenado" como nos outros endpoints de `/app/*`.

## Notificação

- `expo-notifications` no app; permissão pedida uma vez, com frase explicando que é para avisar
  de boleto.
- Chaves FCM (Android) e APNs (iOS) configuradas no projeto EAS `f2b12e95-…`.
- Disparo pelo robô, ao encontrar boleto com `avisado_em` nulo:
  *"Seu boleto de setembro já está disponível — R$ 250,57, vence dia 20."* Tocar abre a aba.
- **Uma vez por boleto, para sempre** — a trava é a UNIQUE de `nosso_numero` mais o
  `avisado_em`, e não variável de memória. Robô que roda três vezes por dia não avisa três vezes.
- O push só sai pelo robô, que só roda em horário comercial — ninguém é acordado de madrugada
  por boleto.

## Segurança

- O boleto só sai pelo CPF do token do associado. Nunca por parâmetro de rota.
- `tenant_id` em toda query, inclusive `findFirst`.
- O segredo do CRM mora em env (`CRM_INTEGRACAO_TOKEN`), nunca em código nem em log.
- O PDF é servido pelo backend conferindo dono — nunca por link público adivinhável.
- O PDF sai por `@Res()` direto, fora do interceptor que embrulha as respostas em `{ data }`.
- Nada de valor, CPF ou linha digitável em log.

## Testes e critério de aceite

1. **Regras (unitário):** boleto pago some; boleto com 5 dias de atraso aparece; com 6 não;
   cancelado não aparece; boleto de outro associado nunca entra na resposta.
2. **Contrato envenenado:** resposta de `/app/boletos` com campo interno plantado não passa na
   allowlist.
3. **Fora da janela:** com o CRM respondendo sem linha digitável e sem link, a aba continua
   mostrando valor e vencimento, e o PDF já guardado continua abrindo.
4. **Idempotência do push:** três passadas do robô no mesmo dia geram **um** aviso.
5. **Fim a fim, manual:** associado de teste com boleto em aberto → recebe push → abre a aba →
   copia o código → baixa o PDF → o arquivo abre. Repetir **num sábado**, com o SGA fechado.
6. `npm run test:mapa` continua verde (nada aqui toca mapa, mas o app é o mesmo binário).

## Riscos e pendências

- ⚠️ **A linha digitável na listagem em massa não está provada.** O campo existe na consulta
  por número do boleto. Se a listagem não trouxer, o robô pergunta boleto a boleto — mais
  lento, mesmo resultado. **Confirmar na segunda-feira, dentro da janela.**
- ⚠️ **A janela do SGA.** Vale levar à Hinova a medição acima: a liberação 00h–23h não saiu.
  Enquanto não sair, o robô só trabalha seg–sex 7h–18h — o desenho já assume isso.
- ⚠️ **Tamanho do banco.** ~850 MB de PDF sobre os 7,1 GB de hoje, girando, medidos a cada
  passada. Se passar de 3 GB, alarme.
- **Dependência do CRM.** Se o CRM cair, a aba mostra o que está guardado, mas para de
  atualizar.
- **As lojas.** A aba só existe para quem atualizar o app; a Apple revisa o build (1–2 dias) e
  já reprovou uma vez por tela branca — `newArchEnabled: false` continua obrigatório.

## Fora de escopo

Pagar dentro do app (Pix ou cartão), gerar segunda via pelo app, negociar dívida, histórico de
boletos pagos, boleto de quem não usa o app. Mostrar e entregar o boleto é o trabalho da aba;
cobrar e negociar continua com o Setor de Boletos.

## Links relacionados

- [[2026-09-11-21GO-CRM-sga-janela-00-23]] — a janela que não foi aplicada
- [[2026-09-11-21GO-CRM-disparo-boleto-numero-oficial]] — o disparo por WhatsApp, que continua no CRM
- [[reference_sga_lookup_exige_boleto]]
- [[feedback_segredos_internos_nunca_pro_associado]]
- [[project_app_unico_dois_mundos]]
