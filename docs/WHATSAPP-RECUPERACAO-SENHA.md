# Recuperação de senha do app — como ligar o WhatsApp

O código já está pronto e no ar. O envio por WhatsApp nasce **desligado**
(`WHATSAPP_PROVIDER=none`) e liga quando você tiver o número. Enquanto isso, o
atendimento pelo painel cobre 100% dos casos.

---

## Como funciona hoje (sem WhatsApp configurado)

| Situação | O que acontece |
|---|---|
| Cliente esqueceu a senha e clica em "Esqueci minha senha" no app | O app avisa que não conseguiu enviar e orienta procurar a associação |
| Cliente liga pra associação | Operador abre **Clientes**, clica em **"Redefinir senha do app"**, o sistema mostra uma senha temporária ditável (ex.: `JUCU-9KBH`) pra passar por telefone/WhatsApp |
| Cliente entra com essa senha | O app **obriga** a criar a senha definitiva na hora |

A senha temporária aparece **uma única vez** — no banco fica só o hash. Se
fechar a janela sem copiar, é só gerar outra.

---

## Ligando o WhatsApp Cloud API (Meta) — o caminho oficial

### 1. O que você precisa ter antes

- Conta no **Meta Business** com o WhatsApp Business configurado
- Um **número dedicado** (não pode estar em uso no WhatsApp comum/Business app)
- **Phone Number ID** e um **token de acesso permanente** (System User Token)

### 2. Criar o template de autenticação (obrigatório)

A Meta **não deixa** enviar código de verificação em mensagem livre — exige um
template da categoria **AUTHENTICATION** aprovado antes. O texto é preset da
Meta, você não escolhe:

> `<CÓDIGO> is your verification code.` (traduzido no idioma escolhido)

No Meta Business → WhatsApp Manager → Modelos de mensagem:

| Campo | Valor |
|---|---|
| Nome | `codigo_verificacao` (ou o que preferir — vai no env) |
| Categoria | **Autenticação** |
| Idioma | Português (BR) — `pt_BR` |
| Corpo | preset (não editável) |
| Rodapé | marcar "expira em" → **15 minutos** |
| Botão | **Copiar código** (recomendado) ou nenhum |

A aprovação costuma sair em minutos. Template de autenticação raramente é
recusado.

### 3. Preencher as variáveis de ambiente

No EasyPanel → serviço `backend-rastreamento` → Environment:

```
WHATSAPP_PROVIDER=meta
WHATSAPP_META_TOKEN=<token permanente>
WHATSAPP_META_PHONE_NUMBER_ID=<id do número>
WHATSAPP_META_TEMPLATE=codigo_verificacao
WHATSAPP_META_LANGUAGE=pt_BR
WHATSAPP_META_API_VERSION=v21.0
# 'false' apenas se você criar o template SEM o botão de copiar código
WHATSAPP_META_COPY_BUTTON=true
```

Depois: redeploy do backend. Não precisa rebuildar imagem — é só variável.

### 4. Testar

1. No app, "Esqueci minha senha" → digitar um CPF de teste que tenha telefone
   cadastrado.
2. Deve chegar a mensagem com o código de 6 dígitos.
3. Nos logs do backend: `Código enviado via Meta para *****-4321`.
   **O código nunca aparece no log** — de propósito.

---

## Alternativa: Evolution API (já roda no seu droplet)

Existe uma Evolution API v2.3.7 no mesmo servidor (do projeto Sinistro), com
números já conectados. Serve pra testar antes do número oficial sair, ou como
contingência. Não exige template aprovado — a mensagem é texto livre.

```
WHATSAPP_PROVIDER=evolution
EVOLUTION_API_URL=https://evolution.sinistro21go.site
EVOLUTION_API_KEY=<a chave da instância>
EVOLUTION_INSTANCE=<nome da instância conectada>
```

⚠️ Contras: a mensagem sai com o número de outro setor, e número não-oficial
pode ser bloqueado pelo WhatsApp se houver denúncia. Para operação de verdade,
o caminho é a Meta.

---

## As travas de segurança (já implementadas)

| Trava | Regra |
|---|---|
| Validade do código | 15 minutos |
| Tentativas erradas | 5 — depois disso o código morre e precisa pedir outro |
| Intervalo entre envios | 2 minutos por CPF (anti-flood) |
| Armazenamento | Só o **hash** do código no banco, nunca o número |
| Vazamento de cadastro | A resposta é **idêntica** para CPF que existe e que não existe — ninguém descobre quem é cliente |
| Nova senha = CPF | Bloqueado |
| Uso do código | Uma vez só; ao usar, é apagado |
| Log | Nunca registra o código, só o número mascarado |

---

## De onde vem o telefone

O telefone do cliente é copiado do **SGA** no momento da instalação (do mesmo
espelho que alimenta as pendências, onde **99,97% dos registros têm telefone**).
Clientes cadastrados antes desta mudança podem não ter telefone — nesses casos
a recuperação cai no atendimento pelo painel, que sempre funciona.
