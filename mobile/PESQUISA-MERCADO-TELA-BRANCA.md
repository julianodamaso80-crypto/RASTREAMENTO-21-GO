# PESQUISA DE MERCADO — Tela branca no TestFlight (cruzada com AUDITORIA-TELA-BRANCA.md)

> Pesquisa feita por Claude (Cowork) em 03/07/2026, com inspeção direta do código do
> projeto + documentação oficial + issues abertas no GitHub (Expo, React Native, Hermes).

---

## VEREDITO PRINCIPAL

**A evidência aponta que o problema NÃO é o código do app.** Existe uma família de bugs
**upstream** (do próprio React Native/Hermes/Expo) que quebra **builds de produção iOS
no iOS 26**, enquanto **builds de desenvolvimento funcionam normalmente** — exatamente o
padrão deste projeto. Isso explica por que 5 builds com correções de JavaScript não
mudaram nada: **a falha acontece antes do JavaScript executar.**

Prova mais forte encontrada: um time relatou **21 builds de teste** e confirmou que até
um **app mínimo, sem nenhum código próprio** (só `<Stack />` no `_layout.tsx`), quebra em
produção no iOS 26 — "nenhum frame do binário do app aparece no stack; o crash é
inteiramente interno do Hermes/RN e inalcançável por mudanças no código do app".
([expo/expo#44680](https://github.com/expo/expo/issues/44680), comentário de alexlencz em
[facebook/react-native#54859](https://github.com/facebook/react-native/issues/54859))

## AS 3 ISSUES UPSTREAM QUE BATEM COM O SINTOMA

1. **[expo/expo#44680](https://github.com/expo/expo/issues/44680)** — SDK 55/56: build de
   produção **crasha no boot (~150ms) em chips A18/A19** (iPhone 16 Pro, 17); dev build
   funciona no MESMO aparelho. "App never reaches the JS layer in production."
   Testaram 20+ builds isolando variáveis (Hermes V0/V1/V2, React Compiler on/off,
   SDK 54/55/56) — **tudo crasha**. Sem correção confirmada até a data desta pesquisa.

2. **[expo/expo#44925](https://github.com/expo/expo/issues/44925)** — SDK 56 + iOS 26 +
   Hermes + New Arch + **Release**: o boot **TRAVA sem crashar** (splash/tela infinita).
   O callback nativo `host:didInitializeRuntime:` nunca dispara, o TurboModule
   `ExpoModulesCore` fica null e `AppRegistry.registerComponent` nunca roda.
   **Esse é o único cenário documentado que produz "tela parada sem crash log"** — o
   sintoma exato relatado na auditoria.

3. **[facebook/react-native#54859](https://github.com/facebook/react-native/issues/54859)**
   — iOS 26, **só em Release**: um TurboModule lança NSException no boot →
   `performVoidMethodInvocation` → SIGABRT. Detalhe relevante: um crash log citava
   `SecureStoreModule.searchKeyChain` (este app **usa expo-secure-store no boot**, no
   `hydrate()`), mas remover o secure-store não resolveu para aquele usuário.
   Correção parcial ([PR #55390](https://github.com/facebook/react-native/pull/55390) /
   fix no RN 0.85.0-rc.7) **não resolveu** os casos dos chips A18/A19.

Relacionadas: [facebook/hermes#1966](https://github.com/facebook/hermes/issues/1966)
(equipe do Hermes confirmou: é bug de thread-safety do RN, não do Hermes; "RN team is
aware and working on a fix in a point release").

## CRUZAMENTO COM A AUDITORIA DO CLAUDE CODE

| Afirmação da auditoria | Resultado da pesquisa |
|---|---|
| "Branco puro no build 12 (que era impossível ficar branco via JS) → JS não executa" | **CONFIRMADO como padrão do bug upstream.** É exatamente o comportamento das issues #44680/#44925: o JS nunca roda em produção. |
| Hipótese nº 1: `@expo/ui` / `expo-glass-effect` instaladas travam o boot | **ENFRAQUECIDA.** Verifiquei o código: **nenhuma lib experimental é usada** (grep em `src/` = zero usos). O crash conhecido do glass-effect ([expo#40911](https://github.com/expo/expo/issues/40911)) só ocorre **ao renderizar** o componente. Remover ainda vale como redução de superfície nativa, mas não é a aposta principal — o time do #44680 removeu módulos não usados e continuou crashando. |
| "Sem crash log = não crasha" | **INCONCLUSIVO.** Se "Compartilhar Análises do iPhone" estiver desativado (Ajustes → Privacidade e Segurança → Análise e Melhorias), crash logs NÃO aparecem na lista. Verificar isso antes de concluir que não há crash. Alternativa no Windows: `pip install pymobiledevice3` + `pymobiledevice3 crash pull` com o iPhone no USB. |
| `react-native-maps` precisa de config plugin | Para Apple Maps (provider default no iOS) **não precisa** de config plugin nem API key. Improvável ser a causa. |
| Rastreador do build 13 é o próximo passo | **CONFIRMADO — é o dado decisivo.** Se nenhum ping chegar, o diagnóstico upstream fica provado. |

Observações extras da inspeção do código:
- `reanimated`/`worklets` estão instalados mas **não são usados em nenhum arquivo** — podem ser removidos (isso também elimina a exigência de New Arch... porém no SDK 56 a New Arch é obrigatória de qualquer forma).
- `app.json` tem `"experiments": { "reactCompiler": true }` — experimental, custo zero para desligar num teste (o time do #44680 testou on/off sem diferença, mas no contexto DELES).
- A Apple hoje revisa em **iOS 26.2+** e o app foi rejeitado por tela branca **no iPad** — consistente com o bug atingir o aparelho do revisor mesmo que o iPhone do dono seja antigo.

## RESPOSTAS DO DONO (coletadas em 03/07/2026)

1. **Aparelho de teste: iPhone 13 Pro (chip A15), iOS 26.5** (confirmado em 04/07/2026).
   Não é o caso A18/A19 do #44680 — MAS o cenário de travamento foi reproduzido em
   iPhone 13 mini (A15) com iOS 26.3.1 no hermes#1966/#54859. **iOS 26.5 confirma o
   diagnóstico upstream** (iOS 26.x + Release + New Arch).

   **FASE 1 EXECUTADA (04/07/2026): CONFIRMADO que o JS não executa.** Dono abriu o build 13
   no iPhone; nos logs do servidor NENHUM ping `APP_DIAG` do app chegou (nem `01-module-loaded`,
   a primeira linha de JS). O endpoint estava vivo (curl de teste logou no mesmo segundo). Boot
   trava na camada nativa antes do bundle Hermes. Segue para Fase 2 (mitigação nativa).
2. **Comportamento: o app FICA ABERTO na tela branca indefinidamente (não fecha).**
   → Bate com o cenário de **boot hang** do expo#44925 (RCTHost nunca inicializa o
   runtime; JS nunca registra o app; **sem crash log** — consistente com o fato de o
   dono não ter achado nada em Dados de Análise).
3. **Build 13 ainda NÃO foi aberto no iPhone** (o dono confundiu com os ajustes do
   iPhone — os "avisos" são enviados automaticamente ao ABRIR o app, não há nada para
   configurar). Próximo passo decisivo: atualizar pro build 13 no TestFlight, abrir o
   app, esperar 10 segundos na tela branca, e ler os logs `APP_DIAG` no servidor.

## PLANO DE AÇÃO RECOMENDADO (em ordem)

**Fase 1 — Confirmar (barato, hoje):**
1. Abrir o build 13 no iPhone e ler os logs `APP_DIAG` no servidor.
2. Ativar "Compartilhar Análises do iPhone", reproduzir a tela branca 2–3x, e olhar
   Ajustes → Análise e Melhorias → Dados de Análise procurando itens com o nome do app.
   (Ou `pymobiledevice3 crash pull` no Windows.)
3. Anotar modelo do iPhone + versão do iOS.

**Fase 2 — Mitigar (se confirmado que o JS não executa):**
4. Atualizar tudo para os patches mais recentes do SDK 56:
   `npx expo install expo@^56 --fix` (os patches do RN 0.85.x incluem correções de
   exceção de TurboModule no boot que saíram DEPOIS da criação deste projeto).
5. Remover módulos nativos não usados (reduz TurboModules registrados no boot):
   `npm uninstall @expo/ui expo-glass-effect expo-symbols expo-device react-native-reanimated react-native-worklets`
   (manter gesture-handler, que é usado no `_layout`; `expo-image` só se realmente não usar).
6. Desligar `reactCompiler` no `app.json` (teste de variável única).
7. Rebuildar e testar. **Uma mudança por build**, senão não se sabe o que resolveu.
8. Adicionar **Sentry** (`@sentry/react-native`) — captura crash nativo direto do device,
   sem precisar de Mac; elimina a cegueira de debug permanentemente.

**Fase 3 — Se nada disso resolver:**
9. O problema é upstream e sem workaround no nível do app (estado do #44680). Opções:
   acompanhar/comentar nas issues #44680 e #54859; testar **RN 0.86 / Expo SDK 57**
   (RN 0.86, lançado em junho/2026, focou em estabilidade); ou aplicar patch manual no
   RN via `patch-package` + build from source (avançado, último recurso).

## FONTES

- https://github.com/expo/expo/issues/44680
- https://github.com/expo/expo/issues/44925
- https://github.com/facebook/react-native/issues/54859
- https://github.com/facebook/react-native/pull/55390
- https://github.com/facebook/hermes/issues/1966
- https://github.com/expo/expo/issues/40911
- https://reactnative.dev/blog/2026/04/07/react-native-0.85
- https://docs.expo.dev/guides/new-architecture/
- https://docs.expo.dev/build-reference/troubleshooting/
- https://medium.com/@matias.turra/react-native-expo-app-shows-blank-screen-on-testflight-but-works-in-expo-go-de6d184ed96d
