---
data: 2026-09-10
projeto: 21Go-Rastreamento
tags: [senha, autenticacao, whatsapp, tecnico, painel, associado]
tipo: decisão
---

# Troca de senha por autoatendimento nos três mundos

## Contexto

O 21 GO tem três autenticações isoladas e cada uma resolve senha de um jeito
diferente — duas com buraco:

| Mundo | Login | Esqueci a senha | Trocar logado |
|---|---|---|---|
| Painel interno (`/auth`) | e-mail + senha | ✓ e-mail (token + link Resend) | ✗ **não existe** |
| App do associado (`/app/auth`) | CPF/CNPJ + senha | ✓ código 6 dígitos no WhatsApp | ✓ |
| Técnico PWA (`/tech/auth`) | CPF + provisória | ✗ **não existe** | ✓ |

Consequência: técnico que perde a senha provisória e usuário interno que quer
trocar a própria senha dependem de alguém resolver na mão. A fila cai no
WhatsApp do dono.

O objetivo é **autoatendimento permanente**: qualquer pessoa dos três mundos
troca a própria senha sozinha, a qualquer hora, sem ligar pra ninguém.

## Decisões tomadas

**O canal é código de 6 dígitos, não senha pronta nem link.** Senha em texto
claro fica pra sempre no histórico do WhatsApp, e WhatsApp clonado viraria
acesso ao rastreamento do carro. Link de redefinição é exatamente o formato do
golpe de phishing — ensinar 364 associados a clicar em link recebido é treinar
a vítima do próximo golpe. Além disso, link exigiria deep link nas duas lojas
(app nativo) e outro caminho no PWA do técnico.

**O código sai pelo WhatsApp oficial da Meta** (número +55 21 99834-5046,
Phone Number ID `1156510420881777`, WABA `1574030237571526`, BM
`2783265268660874`). Exige template da categoria **AUTHENTICATION** aprovado.
A alternativa Evolution API já roda no droplet e não precisa de aprovação, mas
sai de número não-oficial e pode ser bloqueada quando o volume subir.

**Reusar o motor que já roda, não escrever outro.** O fluxo do associado já
está provado em produção com as travas certas; ele vira serviço compartilhado.

## Escopo

### Peça 1 — `PasswordResetService` compartilhado

Extrair de `AssociateAuthService` ([associate-auth.service.ts:336-530](../../../backend/src/modules/app/associate-auth.service.ts))
o motor de recuperação, preservando cada trava atual:

- código via `randomInt` do crypto, 6 dígitos;
- no banco só o **hash bcrypt** do código;
- validade de **15 minutos**;
- morre em **5 tentativas** erradas;
- **um envio a cada 2 minutos** por documento (anti-flood);
- **resposta idêntica** exista ou não o cadastro — a rota não pode virar
  verificador de "esse CPF é cliente de vocês?";
- telefone volta mascarado só quando o envio aconteceu.

O serviço recebe um sujeito abstrato (id, telefone, e como ler/gravar os campos
de código). Implementações: associado e técnico.

`AssociateAuthService` passa a delegar. Comportamento externo **idêntico** —
travado por teste antes da extração.

### Peça 2 — técnico ganha "Esqueci a senha"

- Migration aditiva em `Technician`: `resetCodeHash`, `resetCodeExpiresAt`,
  `resetCodeAttempts`, `resetCodeSentAt` (o `phone String?` já existe).
- `POST /tech/auth/forgot-password` (CPF) e `POST /tech/auth/reset-password`
  (CPF + código + senha nova).
- Reset bem-sucedido grava a senha e deixa `mustChangePassword: false` — a
  senha nova já é a definitiva, escolhida pela pessoa.
- Tela no PWA `/tecnico`, link a partir do login.

### Peça 3 — painel interno ganha "Minha senha"

- `POST /auth/change-password` (senha atual + nova), autenticado.
- Tela em Configurações.
- O esquecimento continua pelo e-mail que já funciona — time interno tem
  e-mail, não precisa de WhatsApp.

### Peça 4 — central de reset no painel (rede de segurança)

Para quem não tem WhatsApp nem e-mail cadastrado.

- Tela restrita a `ADMIN`/`SUPER_ADMIN`, busca por nome/CPF/e-mail nos três
  mundos.
- Botão "gerar senha temporária" → senha ditável por telefone, com troca
  obrigatória no próximo acesso.
- Pro associado isso já existe (`resetPasswordByOperator`, senha ditável) —
  estender para técnico e usuário interno.
- Toda geração deixa rastro em `audit_logs` (quem resetou a senha de quem).

## Arquitetura

```
                       ┌─────────────────────────┐
  app do associado ──▶ │                         │
                       │  PasswordResetService   │──▶ WhatsappService
  PWA do técnico   ──▶ │  (código, travas,       │    (template AUTHENTICATION,
                       │   resposta neutra)      │     Meta Cloud API)
                       └─────────────────────────┘

  painel interno   ──▶ AuthService ──▶ EmailService (Resend, já existe)
                              └─────▶ change-password logado (novo)

  central de reset ──▶ senha temporária ditável nos três mundos + audit_logs
```

`WhatsappService` ganha um `enviarTemplate` genérico — hoje só sabe
`enviarCodigo`.

## Multi-tenant

Técnico é `@@unique([tenantId, cpf])`. A busca do forgot-password **não recebe**
`tenantId` (é rota pública, antes do login), então precisa resolver por CPF
global e falhar de forma neutra se houver mais de um. A central de reset no
painel filtra por `tenantId` do JWT, sem exceção.

## Testes

- Contrato do associado **antes** da extração: mesma resposta, mesmas travas.
- Código expirado, código errado 5x, anti-flood de 2 min, CPF inexistente
  devolvendo resposta idêntica ao existente.
- Técnico sem telefone cadastrado: resposta neutra, sem vazar a ausência.
- `app-boot.spec.ts` verde antes de qualquer deploy (o Nest morre no boot com
  tsc passando — ver [[feedback_validar_boot_antes_do_deploy]]).

## Critérios de aceitação

1. Técnico que perdeu a senha pede código no PWA, recebe no WhatsApp e define a
   senha nova sem falar com ninguém.
2. Usuário do painel troca a própria senha em Configurações informando a atual.
3. Associado continua funcionando exatamente como hoje (teste de contrato).
4. CPF inexistente e CPF sem telefone devolvem a **mesma** resposta de um CPF
   válido.
5. Sexto pedido de código em 2 minutos é recusado.
6. Admin gera senha temporária para os três mundos e a ação aparece em
   `audit_logs`.

## Fora de escopo (decidido em 10/09/2026)

- **Mensagem de boas-vindas com os links das lojas no ato do vínculo** —
  levantado e cortado nesta sessão para não desfocar. Fica registrado que
  `StockService.associate()` ([stock.service.ts:410](../../../backend/src/modules/stock/stock.service.ts))
  é funil único de painel e PWA do técnico, e seria o gancho natural.
  Links: iOS `https://apps.apple.com/br/app/21-tracker-rastreamento/id6785540839`,
  Android `https://play.google.com/store/apps/details?id=com.r21go.client`.
- Forçar troca de senha em massa na base atual.
- Portal público único de senha (`trackgo.site/senha`).

## Pendências que travam produção

1. **Template AUTHENTICATION aprovado** na BM `2783265268660874`. Sem ele o
   provider `meta` não envia.
2. **Envs `WHATSAPP_*` no EasyPanel do rastreamento** — o token oficial hoje
   está configurado no repo do CRM.
3. **Quantos técnicos têm `phone` preenchido** — medir em produção antes de
   subir, senão o autoatendimento do técnico nasce inútil.
4. **Limite de botões URL em template da Meta** — ler a doc oficial antes de
   desenhar o template, não presumir.

## Links relacionados

- [[reference_recuperacao_senha_app]]
- [[reference_whatsapp_cloud_21go_crm]]
- [[reference_app_login_regra]]
- [[feedback_nunca_burlar_regra_login_app]]
- [[project_tecnicos_pwa]]
