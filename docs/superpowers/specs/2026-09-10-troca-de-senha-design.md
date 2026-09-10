---
data: 2026-09-10
projeto: 21Go-Rastreamento
tags: [senha, autenticacao, whatsapp, tecnico, painel, associado]
tipo: decisão
---

# Esqueci a senha — um botão só, para todo mundo

## O que é

Um botão "Esqueci a senha" na tela de login de **todos** os acessos ao sistema —
site (`trackgo.site`), app Android, app iOS e PWA do técnico. O fluxo é sempre
o mesmo:

```
clica em "Esqueci a senha"
  → digita o CPF
  → código de 6 dígitos chega no WhatsApp (número oficial 5046)
  → digita o código
  → escolhe a senha nova
  → entra
```

Sem link, sem e-mail, sem ligar pra ninguém.

## Por onde estamos hoje

| Acesso | Esqueci a senha hoje |
|---|---|
| App do associado | ✓ já funciona (código no WhatsApp) |
| Painel web | ◐ existe, mas por **e-mail com link** |
| PWA do técnico | ✗ não existe |

Ou seja: o motor já está escrito e provado em produção
([associate-auth.service.ts:336-530](../../../backend/src/modules/app/associate-auth.service.ts)).
Falta levá-lo aos outros dois e padronizar o canal.

## Decisões

**Código de 6 dígitos, não senha pronta nem link.** Senha mandada pelo WhatsApp
fica pra sempre no histórico do aparelho — WhatsApp clonado viraria acesso ao
rastreamento do carro. Link de redefinição é o formato do golpe de phishing:
treinar o associado a clicar em link recebido é prepará-lo pro próximo golpe.
E link exigiria deep link nas duas lojas mais um caminho separado no PWA.

**Um canal só para todos: o WhatsApp oficial 5046.** Painel web também. Uma
explicação só pro suporte dar, um mecanismo só pra manter.

**Quem não tem WhatsApp cadastrado é obrigado a cadastrar no login.** Popup
bloqueante: não avança pra tela nenhuma sem informar o número. O número é
**confirmado por código na hora** — número não verificado deixa a recuperação
quebrada ou, pior, manda o código pro WhatsApp de outra pessoa. Usa o mesmo
motor, então não custa trabalho extra.

## Escopo

### 1. Motor único de código

Extrair de `AssociateAuthService` o motor de recuperação e transformá-lo em
`PasswordResetService`, preservando cada trava atual:

- código via `randomInt` do crypto, 6 dígitos;
- no banco só o **hash bcrypt** do código, nunca o código;
- validade de **15 minutos**;
- morre em **5 tentativas** erradas;
- **um envio a cada 2 minutos** por documento;
- **resposta idêntica** exista ou não o cadastro — a rota não pode virar
  verificador de "esse CPF é cliente de vocês?";
- telefone volta mascarado, e só quando o envio aconteceu.

O serviço atende três sujeitos: `Associate`, `Technician`, `User`.
`AssociateAuthService` passa a delegar — comportamento externo **idêntico**,
travado por teste de contrato escrito **antes** da extração.

### 2. "Esqueci a senha" nos três acessos

- **App do associado:** já existe, passa a usar o serviço compartilhado. Nada
  muda para o usuário.
- **PWA do técnico:** `POST /tech/auth/forgot-password` e
  `POST /tech/auth/reset-password`, mais a tela e o link no login. O reset
  grava a senha e zera `mustChangePassword` — a senha escolhida já é a
  definitiva.
- **Painel web:** o botão passa a usar WhatsApp em vez do e-mail. O fluxo de
  e-mail atual (`forgotPassword`/`resetPassword` com token) **continua no
  código**, sem ponto de entrada na interface; remover é decisão do dono.

### 3. Popup obrigatório de WhatsApp no login

Vale para os três acessos. No login, se a conta não tem telefone verificado:

1. Popup bloqueante pede o número (não fecha, não dá pra navegar).
2. Código de 6 dígitos vai pro número informado.
3. Pessoa digita o código → `phoneVerifiedAt` é gravado → segue pro sistema.

O associado normalmente já vem com telefone do SGA, mas **telefone vindo do SGA
não conta como verificado** — ninguém provou que aquele número recebe. Ele
passa pelo popup uma vez.

### 4. Banco (migration aditiva)

| Model | Campos |
|---|---|
| `User` | `phone String?`, `phoneVerifiedAt DateTime?`, `resetCodeHash`, `resetCodeExpiresAt`, `resetCodeAttempts`, `resetCodeSentAt` |
| `Technician` | `phoneVerifiedAt DateTime?`, `resetCodeHash`, `resetCodeExpiresAt`, `resetCodeAttempts`, `resetCodeSentAt` (já tem `phone`) |
| `Associate` | `phoneVerifiedAt DateTime?` (já tem `phone` e os campos de código) |

Nada é removido, nada vira obrigatório no banco.

## Arquitetura

```
 app do associado  ─┐
 PWA do técnico    ─┼─▶ PasswordResetService ─▶ WhatsappService ─▶ Meta Cloud API
 painel web        ─┘   (código, travas,          (enviarTemplate)    número 5046
                         resposta neutra)
```

`WhatsappService` ganha `enviarTemplate` genérico — hoje só sabe `enviarCodigo`.

## Multi-tenant

`Technician` é `@@unique([tenantId, cpf])` e o forgot-password é rota pública,
antes do login — não há `tenantId` disponível. A busca resolve por CPF global e
falha de forma neutra se houver mais de um. Toda rota autenticada segue
filtrando por `tenantId` do JWT, sem exceção.

## Testes

- Contrato do associado **antes** da extração: mesma resposta, mesmas travas.
- Código expirado, código errado 5 vezes, anti-flood de 2 minutos.
- CPF inexistente e CPF sem telefone devolvem resposta **idêntica** à de um CPF
  válido.
- Popup: conta sem `phoneVerifiedAt` não alcança nenhuma rota protegida.
- `app-boot.spec.ts` verde antes de qualquer deploy — tsc e testes passam e o
  Nest ainda pode morrer no boot.

## Critérios de aceitação

1. Técnico que perdeu a senha pede o código no PWA, recebe no WhatsApp e define
   a senha nova sem falar com ninguém.
2. Usuário do painel web faz o mesmo, pelo WhatsApp.
3. Associado continua funcionando exatamente como hoje.
4. Conta sem telefone verificado não passa do popup no login.
5. Número digitado no popup só é aceito depois do código conferido.
6. CPF inexistente e CPF sem telefone devolvem a mesma resposta de um CPF
   válido.
7. Sexto pedido de código em dois minutos é recusado.

## Fora de escopo

- **Biometria (Face ID) + sessão salva por 6 meses no app** — decidido em
  10/09/2026: entrega seguinte, depois deste botão estar no ar. É login do dia
  a dia, não recuperação de senha.
- Central de reset assistida pelo suporte — o popup obrigatório de WhatsApp
  tornou-a desnecessária.
- Mensagem de boas-vindas com links das lojas no vínculo. Gancho natural seria
  `StockService.associate()` ([stock.service.ts:410](../../../backend/src/modules/stock/stock.service.ts)),
  funil único de painel e PWA. Links: iOS
  `https://apps.apple.com/br/app/21-tracker-rastreamento/id6785540839`,
  Android `https://play.google.com/store/apps/details?id=com.r21go.client`.
- Forçar troca de senha em massa na base atual.

## Pendências que travam produção

1. **Template AUTHENTICATION aprovado** na BM `2783265268660874` (WABA
   `1574030237571526`, número +55 21 99834-5046, Phone Number ID
   `1156510420881777`). Sem ele o provider `meta` não envia. Aguardando decisão
   do dono sobre quem cria.
2. **Envs `WHATSAPP_*` no EasyPanel do rastreamento** — o token oficial hoje
   está configurado no repo do CRM.
3. **Quantos técnicos e usuários têm telefone** — medir em produção antes de
   subir, para saber o tamanho do impacto do popup no primeiro dia.

## Links relacionados

- [[reference_recuperacao_senha_app]]
- [[reference_whatsapp_cloud_21go_crm]]
- [[reference_app_login_regra]]
- [[feedback_nunca_burlar_regra_login_app]]
- [[project_tecnicos_pwa]]
