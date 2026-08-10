---
data: 2026-08-10
projeto: 21 GO Rastreamento
tags: [mobile, auth, permissoes, isolamento, associado, time-interno]
tipo: decisão
---

# App único, dois mundos — associado e time interno no mesmo binário

## Contexto

O app [21 Tracker](../../../mobile) está publicado nas duas lojas
(`com.r21go.client`) e hoje atende **só o associado**: fala exclusivamente com
`/app/*`, autentica por CPF, guarda um JWT com `type: 'associate'` e é isolado
pelo [AssociateJwtGuard](../../../backend/src/modules/app/guards/associate-jwt.guard.ts).

O time interno usa outro mundo inteiro: tabela `User` com `role` +
`allowedRoutes`, painel Next.js em `trackgo.site`, rotas `/api/v1/*` protegidas
por `JwtAuthGuard` + [RouteAccessGuard](../../../backend/src/common/guards/route-access.guard.ts).

O dono quer **um binário só** nas lojas servindo os dois públicos: quem baixa
loga com o que tem, e cai no painel que lhe cabe. Associado vê o carro dele;
funcionário vê o sistema de trabalho, limitado ao que a permissão dele libera.

**Requisito inegociável:** associado nunca enxerga dado do time interno, e
nenhum dado interno pode vazar pro lado do cliente. Rastreamento veicular em
tempo real é dado de perseguição e de roubo dirigido — vazamento aqui não é
constrangimento, é risco físico pra pessoa.

### Fragilidade encontrada na auditoria (motiva a Fase 1)

Os dois tipos de token são assinados com **o mesmo segredo** (`jwt.secret`), e
[jwt.strategy.ts](../../../backend/src/modules/auth/strategies/jwt.strategy.ts)
**não verifica o campo `type` do payload**. Hoje um token de associado não passa
no mundo interno apenas porque o `sub` dele não existe na tabela `User` — ou
seja, o isolamento está apoiado numa coincidência de identificadores, não numa
regra explícita. Com um app único servindo os dois públicos, isso precisa virar
barreira criptográfica antes de qualquer outra coisa.

## Decisões (validadas com o dono em 2026-08-10)

| Decisão | Escolha | Motivo |
|---|---|---|
| Escopo do time interno no app | **Tudo que a permissão dele libera**, igual ao painel web | Foi o pedido explícito: "tem que ver tudo que ele tem permissão igual ele vê na URL" |
| Como entregar a paridade | **Híbrido**: painel web embarcado + telas nativas onde importa | Paridade automática com as 16 telas e **uma implementação só** da regra de permissão. Duas implementações divergindo é onde vazamento nasce |
| Login | **Um campo só** (`CPF ou e-mail`), roteia pelo formato | Zero atrito pro associado, que é quem baixa em volume; nenhum endpoint novo |
| Pessoa que é dos dois lados | **Duas contas, uma sessão viva por vez** | Nenhum token carrega os dois poderes ao mesmo tempo |
| Sessão interna | **Biometria + expiração curta (12h)** | Celular do time perdido carrega o painel inteiro no bolso |
| Telas internas nativas | Estoque+Associar (câmera), Pendências, Rota, Mapa+push | Escolha do dono — distribuídas entre as Fases 2 e 3 |

## Decomposição em fases

O escopo aprovado não cabe numa spec só. Três entregas, cada uma com spec e
plano próprios:

| Fase | Entrega | Estado |
|---|---|---|
| **1 — Fundação de isolamento** | Login único, dois mundos, token tipado, segredos separados, biometria, painel embarcado, suíte de vazamento | **Esta spec** |
| **2 — Campo nativo** | Estoque + Associar com leitura de IMEI por câmera, Pendências, Rota Inteligente | Spec futura |
| **3 — Plantão móvel** | Mapa nativo da frota + push de SOS/alertas | Spec futura; exige infra de push que não existe (hoje só WhatsApp + dispatcher) |

Esta spec cobre **exclusivamente a Fase 1**.

---

## Arquitetura da Fase 1

### Fatia 1 — Barreira de isolamento no backend

Cinco camadas independentes, de modo que nenhuma falha sozinha vaze dado.

**1.1 Segredos criptográficos separados.** O mundo do associado passa a assinar
com `JWT_ASSOCIATE_SECRET`; o painel mantém `JWT_SECRET`. Um token do associado
deixa de ser sequer *verificável* no mundo interno — falha na assinatura, antes
de qualquer lógica de aplicação. É a camada mais forte porque não depende de
alguém lembrar de checar campo nenhum.

- `config/configuration.ts` ganha `jwt.associateSecret` e
  `jwt.internalExpiration`.
- `app-associate.module.ts` passa a registrar o `JwtModule` com o segredo do
  associado; `AssociateJwtGuard` verifica com ele.
- Se `JWT_ASSOCIATE_SECRET` estiver ausente ou **igual** a `JWT_SECRET`, o
  backend **falha ao subir** com mensagem explícita. Configuração errada não
  pode passar despercebida.

**1.2 Token tipado e exigido.** Todo JWT carrega `type: 'user' | 'associate'`.

- `JwtStrategy.validate` rejeita payload cujo `type` não seja `'user'`.
- `AssociateJwtGuard` já rejeita `type !== 'associate'` — mantido.
- **Rollout em dois deploys**, pra não derrubar quem está logado no painel:
  - Deploy A: `/auth/login` passa a emitir `type: 'user'`; `JwtStrategy`
    rejeita `type === 'associate'` e tolera token legado sem `type`.
  - Deploy B (após 24h, quando todo token legado já expirou): `JwtStrategy`
    passa a **exigir** `type === 'user'`.

**1.3 Expiração própria do mundo interno.** `JWT_INTERNAL_EXPIRATION`, padrão
`12h` (hoje os dois compartilham `JWT_EXPIRATION=24h`). Teto duro: passou,
senha de novo.

**1.4 Suíte automatizada de vazamento.** Ver Fatia 5.

**1.5 O `RouteAccessGuard` continua juiz único.** O app não decide o que o
usuário pode ver; ele desenha o que o backend liberou em `allowedRoutes`. Menu
escondido é conforto visual, nunca segurança.

### Fatia 2 — Login único e roteamento no app

Uma tela, um campo `CPF ou e-mail` + senha. A decisão acontece **antes** de
qualquer chamada de rede:

| Entrada | Destino |
|---|---|
| 11 dígitos após remover máscara | `POST /app/auth/login` — mundo associado |
| Contém `@` | `POST /auth/login` — mundo interno |
| Nenhum dos dois | Erro de formato local, sem bater na API |

O erro de credencial é **idêntico** nos dois caminhos ("CPF/e-mail ou senha
inválidos"). Mensagem que varia transforma o app em verificador de quais
e-mails pertencem ao time — primeiro passo de ataque dirigido.

**Dois clientes HTTP isolados.** `apiAssociado` e `apiInterno`, cada um com sua
chave no SecureStore (`associate.token` / `internal.token`) e seu próprio
interceptor. Não existe "o token" genérico: uma tela do associado é incapaz de
montar requisição interna porque não tem acesso ao objeto que sabe fazer isso.

**Uma sessão viva por vez.** Logar num mundo apaga o token do outro. No boot:

- só interno → mundo interno (pede biometria)
- só associado → mundo associado
- **os dois presentes → apaga os dois e volta pro login** (fail closed)

O fluxo do associado não muda em nada: mesma troca obrigatória de senha no
primeiro acesso e mesmo "esqueci minha senha" por código no WhatsApp.

### Fatia 3 — Painel embarcado (mundo interno)

O painel guarda a sessão em `localStorage.token`
([api.ts:56](../../../frontend/dashboard/src/lib/api.ts#L56)). A WebView escreve
`token` e `user` no `localStorage` de `trackgo.site` via
`injectedJavaScriptBeforeContentLoaded` — antes do primeiro script da página
rodar — e o painel abre já logado. O funcionário digita a senha uma vez, no app.

Dependência nova: `react-native-webview` (compatível com Expo SDK 54 e
`newArchEnabled: false`, que é obrigatório neste projeto — ver
[AUDITORIA-TELA-BRANCA.md](../../../mobile/AUDITORIA-TELA-BRANCA.md)).

Quatro travas:

**Navegação em allowlist.** `onShouldStartLoadWithRequest` só permite
`trackgo.site`. Qualquer outro destino abre no navegador do sistema — a WebView
autenticada nunca renderiza página de terceiro.

**Sessão descartável.** Sair, expirar ou trocar de conta limpa cookies, cache e
`localStorage` da WebView antes de liberar a tela.

**Uma fonte de sessão só.** Se o painel devolver 401 e tentar redirecionar pro
próprio `/login`, o app intercepta a navegação e derruba pro login nativo.
Ninguém digita senha dentro da WebView — duas sessões concorrentes é onde a
bagunça vira vazamento.

**Casca nativa.** Barra fina no topo com nome do usuário e botão Sair, pra ele
nunca ficar preso dentro da página.

A paridade sai de graça: a sidebar do painel já filtra por `allowedRoutes`
([sidebar.tsx](../../../frontend/dashboard/src/components/layout/sidebar.tsx)) e
já tem drawer mobile.

### Fatia 4 — Biometria e ciclo de sessão

- `expo-local-authentication` (nova dependência). Face ID / digital ao abrir o
  app e ao voltar do background depois de **5 minutos** parado.
- Aparelho sem biometria cadastrada → PIN/senha do sistema. Sem nem isso → o
  mundo interno exige a senha do painel toda vez. Não existe botão "pular".
- Três falhas biométricas seguidas derrubam a sessão (apaga token, limpa
  WebView).
- **Sem refresh token nesta fase.** Ele não existe no projeto hoje, e inventar
  renovação de sessão amplia superfície justamente na entrega cujo objetivo é
  fechá-la. Custo: uma digitação de senha por turno.
- Revogação imediata já funciona e é mantida: `JwtStrategy` consulta o banco a
  cada request, então desativar o usuário em `/usuarios` mata o acesso no
  próximo toque, inclusive dentro da WebView.

### Fatia 5 — Prova de que não vaza

Matriz de teste e2e no backend, **gerada varrendo os controllers** em vez de
escrita à mão — rota criada daqui a seis meses nasce coberta:

| Token | Alvo | Esperado |
|---|---|---|
| Associado | toda rota interna | 401 / 403 |
| Interno | `/app/*` | 401 |
| Associado do tenant A | dado do tenant B | 403 / 404 |
| Sem campo `type` | qualquer rota interna | 401 (após o deploy B) |
| Assinado com o segredo do outro mundo | qualquer rota | 401 |

A última linha prova que os segredos são de fato distintos — sem ela, alguém
aponta as duas variáveis de ambiente pro mesmo valor e ninguém percebe.

No app, testes unitários de:
- roteador de login (CPF → endpoint do associado; e-mail → interno; lixo → erro
  local)
- boot com dois tokens presentes → apaga os dois

E validação manual em produção com curl real antes de considerar entregue, no
padrão já exigido no projeto.

## Critérios de aceitação

1. Associado loga com CPF e vê exatamente o que vê hoje — nada mudou pra ele.
2. Funcionário loga com e-mail **no mesmo app** e cai no painel, com as telas do
   `allowedRoutes` dele e só elas.
3. Token de associado em qualquer rota interna → 401/403, comprovado por suíte
   automatizada, não por inspeção visual.
4. Token interno em `/app/*` → 401.
5. Backend recusa subir se `JWT_ASSOCIATE_SECRET` faltar ou for igual ao
   `JWT_SECRET`.
6. Sair limpa cookies e `localStorage` da WebView; reabrir não mostra nada da
   sessão anterior.
7. Desativar o usuário em `/usuarios` derruba o acesso dele no app no próximo
   toque.
8. Voltar do background depois de 5 minutos pede biometria.
9. Painel (`trackgo.site`) e API (`api.trackgo.site/api/v1/health`) respondem
   200 antes e depois de cada deploy.

## Riscos declarados

| Risco | Mitigação |
|---|---|
| **Apple, diretriz 4.2** (app que é invólucro de site é reprovado) | O mundo do associado é nativo e substancial; o painel embarcado é área restrita a funcionário, não o app inteiro. A Fase 2 (telas internas nativas) é a resposta definitiva |
| **Conta de teste pro review da Apple** | Criar um usuário interno de demonstração em tenant com dados fictícios. **Nunca** credencial de produção. Item operacional do dono, não de código |
| **Deploy B derruba sessões do painel** | Programado pra depois de 24h, quando todo token legado já expirou naturalmente |
| **Build iOS/Android com dependências nativas novas** | `react-native-webview` e `expo-local-authentication` exigem novo build EAS (não é OTA). Manter `newArchEnabled: false` e SDK 54 — regressão conhecida de tela branca no iOS 26 |

## Fora de escopo (declarado)

- Telas internas nativas (Fases 2 e 3).
- Push notification — não há infra hoje.
- Refresh token.
- Expiração de 24h do token do associado: mantida como está. É a mesma de hoje;
  mexer nela é decisão de produto separada.
- Troca obrigatória de senha no primeiro login do usuário interno — segue como
  decisão consciente registrada na sessão de 2026-08-10.

## Links relacionados

- [[2026-08-10-21Go-Rastreamento-usuarios-acessos]] — origem do `allowedRoutes`
- [[2026-07-30-21Go-Rastreamento-login-cpf]] — regra de acesso do associado
- [AUDITORIA-TELA-BRANCA.md](../../../mobile/AUDITORIA-TELA-BRANCA.md) — por que
  `newArchEnabled: false` e SDK 54 são obrigatórios
