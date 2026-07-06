# AUDITORIA SINCERA — App iOS abre em TELA BRANCA (Expo / TestFlight)

> Documento para levar a pesquisa externa / outra IA. Autocontido e honesto.
> Escrito por Claude (assistente) para o dono do projeto, Juliano.

---

## 0. RESUMO EM UMA FRASE

Um app **Expo (React Native)** compila e sobe pro **TestFlight** sem erro, mas ao
**abrir no iPhone (build de produção)** fica em **tela branca** e não avança. **Funciona
no navegador (Expo web)**. **NÃO há crash log** no device. Já foram feitos **5 builds
(9 a 13)** com correções de JavaScript e **nenhuma resolveu** — o que indica que a causa
**não está no código JS**, e sim em algo **nativo / de configuração / de build**.

---

## 1. CONFISSÃO HONESTA (limitações reais)

- Estou desenvolvendo no **Windows, sem Mac e sem iPhone físico** acessível a mim.
- **Não consigo rodar o app num simulador iOS nem debugar no device.** Isso é o cerne da
  dificuldade: estou corrigindo **às cegas**, e cada tentativa depende do dono testar no
  iPhone dele. É intelectualmente desonesto qualquer IA dizer "testei o app iOS" sem device.
- Já gastamos **muitas horas e 5 builds**. Não consegui resolver. Por isso esta auditoria:
  levar o problema a quem tenha um Mac/device ou conhecimento específico de builds nativos.

---

## 2. O QUE É O PROJETO

- App **companion** de uma plataforma de rastreamento veicular (marca "Track Go" / "21 Go").
- Fluxo: **login por CPF + senha** → **mapa com satélite** (posição do veículo) →
  **histórico de trajeto** → **alertas** → **perfil**.
- Backend **NestJS em produção** (`https://api.trackgo.site`) — funciona 100%, login testado
  via curl retornando HTTP 201.
- App construído com **Expo SDK 56 + Expo Router**, buildado via **EAS Build** (nuvem, sem Mac).
  Credenciais iOS (certificado + provisioning profile) criadas via **App Store Connect API**.
- Pasta: `mobile/`. Bundle id: `com.r21go.client`. App Store Connect app id: `6785540839`.

---

## 3. O SINTOMA EXATO

- `eas build` termina em **FINISHED** (sem erro de compilação).
- Sobe pro TestFlight, instala no iPhone.
- Ao **abrir**, mostra **tela branca** e **trava** (não vai pro login).
- **Funciona no navegador** (`expo export --platform web` + servir → chega no login, zero erros).
- **NÃO existe crash log** do app no iPhone (Ajustes → Privacidade → Análises → Dados de
  Análise **não tem** nenhum item `r21go.client`). Ou seja: **o app não crasha, ele trava
  em branco.**

---

## 4. STACK E VERSÕES EXATAS (`mobile/package.json`)

```
expo ~56.0.12
react-native 0.85.3
react 19.2.3
expo-router ~56.2.11
react-native-reanimated 4.3.1     <- REQUER New Architecture
react-native-worklets 0.8.3
react-native-maps 1.27.2          <- tem codegenConfig (suporta New Arch)
react-native-svg 15.15.4
react-native-gesture-handler ~2.31.1
react-native-screens 4.25.2
react-native-safe-area-context ~5.7.0
expo-secure-store ~56.0.4         <- usado no boot (ler login salvo)
expo-splash-screen ~56.0.10
@expo/vector-icons ^15.0.2
zustand ^5.0.14, axios ^1.18.1, date-fns ^4.4.0

# LIBS DO TEMPLATE QUE NAO USO MAS ESTAO INSTALADAS (autolinkadas no nativo):
@expo/ui ~56.0.18                 <- EXPERIMENTAL
expo-glass-effect ~56.0.4         <- EXPERIMENTAL / novo
expo-symbols ~56.0.6
expo-image ~56.0.11
expo-device ~56.0.4
```

- **New Architecture (Fabric/TurboModules):** `newArchEnabled` está **undefined** no
  `app.json` → usa o **default do SDK 56, que é LIGADO**.
- `"main": "expo-router/entry"`.
- Plugins no `app.json`: `expo-router`, `expo-secure-store`, `expo-splash-screen`
  (backgroundColor `#293c82`, image `./assets/images/splash-icon.png`).
- **`app.json` NÃO tem config plugin de `react-native-maps`** (não sei se precisa).

---

## 5. HISTÓRICO DE TENTATIVAS (o que já falhou)

| Build | O que mudei | Resultado |
|---|---|---|
| **9** | Versão original | Tela branca. (tinha 2 bugs reais: a rota inicial `/` não existia + `_layout` retornava `null` enquanto carregava) |
| **11** | Criei `src/app/index.tsx` (rota `/`) redirecionando pro login; `hydrate()` com try/catch; controle de splash | Tela branca |
| **12** | `_layout` **sempre renderiza** (removi o `return null`); tela de carregamento **visível** (fundo azul + spinner); **failsafe de 4s** no carregamento; `export { ErrorBoundary } from 'expo-router'` | **Tela branca** (crítico — ver §6) |
| **13** | Adicionei **rastreador de boot** (pings pro backend) — só diagnóstico | Aguardando dado |

**Validações que passam a cada build:** `tsc --noEmit` (0 erros), `expo export --platform ios`
(bundle gera OK), `expo export --platform web` + rodar no navegador com **mock de
react-native-maps** (chega no login, **zero erros de runtime**).

---

## 6. A EVIDÊNCIA MAIS FORTE (e o que ela sugere)

No **build 12**, a tela de carregamento foi feita **impossível de ser branca**: fundo
**azul-marinho (#293c82) com um spinner laranja**, garantido a renderizar enquanto o app
carrega. Além disso, um **ErrorBoundary** mostraria qualquer erro de render como texto.

**Mesmo assim o resultado foi BRANCO PURO** (não azul, não spinner, não mensagem de erro).

Isso é a pista central: **se o JavaScript estivesse executando, o usuário veria pelo menos
o fundo azul + spinner, OU a tela de erro.** Branco puro sugere que **o bundle JavaScript
não está executando no iOS de produção** — ou seja, o problema é **antes do React montar**
(inicialização nativa / bundle Hermes / registro de módulos), o que **não gera crash log**
em alguns casos.

> Ressalva honesta: **não está 100% confirmado** que o dono testou exatamente o build 12/13
> (havia vários builds no TestFlight e a API da Apple estava inconsistente ao listar). O
> rastreador do build 13 (§7) existe justamente para eliminar essa dúvida.

---

## 7. O RASTREADOR (build 13) — o próximo dado decisivo

Coloquei no app uma função que chama `GET https://api.trackgo.site/diag?e=<etapa>&b=13`
em **8 pontos** do boot. O backend loga cada chamada (`APP_DIAG build=13 event=...`),
visível em `docker service logs`. Testei manualmente: **funciona** (o log aparece).

Pontos rastreados, em ordem:
1. `01-module-loaded` — primeira linha de JS quando o bundle carrega (topo do `_layout`)
2. `02-root-render` — componente raiz renderiza
3. `03-effect-hydrate` — efeito de boot dispara
4. `06-hydrate-start` — começa a ler o login salvo (SecureStore)
5. `07-hydrate-done`/`error` — SecureStore respondeu
6. `08-hydrate-failsafe` — timeout de 4s disparou (SecureStore travou)
7. `04-index-render` — rota inicial `/` renderiza
8. `05-login-render` — tela de login renderiza

**Interpretação do que vier nos logs:**
- **NENHUM ping** → o JS não executa nada → problema **nativo/bundle** (antes do JS).
- **Para em `01`** → módulo carrega mas o React não monta.
- **Chega em `06` mas não `07`/`08`** → **SecureStore trava** (módulo nativo pendurado).
- **Chega em `05`** → o app funciona; o "branco" seria visual/outra coisa.

**ESTE DADO AINDA NÃO FOI CAPTURADO** (o build 13 acabou de ficar disponível no TestFlight).
É o próximo passo mais valioso: **abrir o build 13 no iPhone e ler os logs do backend.**

---

## 8. HIPÓTESES ATIVAS (não confirmadas, ordenadas por suspeita)

1. **Módulo nativo experimental do template travando o boot na New Architecture.**
   `@expo/ui` e `expo-glass-effect` são libs **novas/experimentais** que vieram no template e
   **não uso**, mas continuam **autolinkadas no nativo**. Se uma delas falha ao registrar no
   Fabric no boot, poderia travar o app em branco **sem crash log**. → **Testar removê-las.**
2. **`react-native-maps` sem config plugin no `app.json`** — verificar se o EAS/prebuild
   precisa de configuração adicional (a lib suporta New Arch, mas a integração Expo pode exigir algo).
3. **Erro na inicialização do bundle Hermes** que só ocorre em produção (não em dev/web).
4. **SecureStore travando** no boot (o `hydrate` lê SecureStore logo no início). O failsafe de
   4s deveria cobrir, mas se o travamento for **nativo** (não uma Promise JS), o failsafe não age.
5. **New Architecture** em geral incompatível com alguma das libs na versão instalada.
6. **(não descartado)** O dono testou um build antigo por confusão de múltiplos builds no TestFlight.

---

## 9. CÓDIGO RELEVANTE (arquivos do boot)

### `mobile/src/app/_layout.tsx`
```tsx
import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from '@/lib/auth-store';
import { colors } from '@/lib/theme';
import { diag } from '@/lib/diag';
export { ErrorBoundary } from 'expo-router';
diag('01-module-loaded');
export default function RootLayout() {
  diag('02-root-render');
  const router = useRouter();
  const segments = useSegments();
  const { token, hydrated, hydrate } = useAuth();
  useEffect(() => { diag('03-effect-hydrate'); hydrate(); }, [hydrate]);
  useEffect(() => {
    if (!hydrated) return;
    const inApp = segments[0] === '(tabs)' || segments[0] === 'vehicle';
    if (!token && inApp) router.replace('/login');
    else if (token && !inApp) router.replace('/(tabs)');
  }, [token, hydrated, segments, router]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="vehicle/[id]" options={{ headerShown: true, title: 'Histórico' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
```

### `mobile/src/app/index.tsx` (rota inicial `/`)
```tsx
import { Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from '@/lib/auth-store';
import { colors } from '@/lib/theme';
import { diag } from '@/lib/diag';
export default function Index() {
  diag('04-index-render');
  const { token, hydrated } = useAuth();
  if (!hydrated) return (
    <View style={styles.loading}><ActivityIndicator size="large" color={colors.orange} /></View>
  );
  return <Redirect href={token ? '/(tabs)' : '/login'} />;
}
const styles = StyleSheet.create({ loading: { flex:1, alignItems:'center', justifyContent:'center', backgroundColor:'#293c82' } });
```

### `mobile/src/lib/auth-store.ts` (hydrate — lê SecureStore no boot)
```tsx
hydrate: async () => {
  diag('06-hydrate-start');
  const failsafe = setTimeout(() => {
    if (!useAuth.getState().hydrated) { diag('08-hydrate-failsafe'); set({ token:null, name:null, hydrated:true }); }
  }, 4000);
  try {
    const [token, name] = await Promise.all([
      SecureStore.getItemAsync('r21go.associate.token'),
      SecureStore.getItemAsync('r21go.associate.name'),
    ]);
    clearTimeout(failsafe); diag('07-hydrate-done'); set({ token, name, hydrated:true });
  } catch { clearTimeout(failsafe); diag('07-hydrate-error'); set({ token:null, name:null, hydrated:true }); }
}
```

### `mobile/metro.config.js` (adicionado nos builds 11+; só afeta web)
```js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
const orig = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-maps')
    return { type:'sourceFile', filePath: path.resolve(__dirname,'src/lib/maps-mock.web.js') };
  return (orig || context.resolveRequest)(context, moduleName, platform);
};
module.exports = config;
```
> Nota: o build 9 (já branco) **não tinha** este `metro.config.js`, então ele não é a causa raiz.

---

## 10. PERGUNTAS OBJETIVAS PARA PESQUISA / OUTRA IA

1. **Expo SDK 56 + New Architecture**: app fica em **tela branca em produção iOS (TestFlight)**,
   mas **funciona em dev/web**, e **sem crash log**. Quais as causas conhecidas?
2. As libs **`@expo/ui`** e **`expo-glass-effect`** (SDK 56, experimentais) causam **branco/crash
   no boot** quando instaladas mas não usadas? Vale **desinstalar** e rebuildar?
3. **`react-native-maps` 1.27** com **Expo prebuild + New Arch**: precisa de **config plugin**
   no `app.json`? A ausência causa tela branca?
4. Como **debugar "JS não executa" em produção iOS sem Mac**? (ex.: **Sentry**, logging remoto,
   `console` via TestFlight, `eas build --profile preview` com dev menu, etc.)
5. Vale **desligar a New Architecture** (`"newArchEnabled": false`)? — **Atenção:**
   `react-native-reanimated 4` **exige** New Arch; desligar quebra o reanimated. Existe caminho?
6. Há **incompatibilidade conhecida** entre `react-native 0.85.3` / Hermes e alguma dessas libs?

---

## 11. PRÓXIMO PASSO RECOMENDADO (barato e decisivo)

**Abrir o build 13 no iPhone e ler `docker service logs ... | grep APP_DIAG` no backend.**
Isso responde de forma **definitiva** se o JS executa e até onde. Sem esse dado, qualquer
correção é chute. **Com** esse dado, a causa fica localizada e a correção vira cirúrgica.

Se o dado mostrar "nenhum ping" → a aposta seguinte é **remover `@expo/ui` e
`expo-glass-effect`** e rebuildar (hipótese nº 1).

---

## 12. ACESSOS / FATOS ÚTEIS

- Backend logs: `ssh root@167.71.31.77` → `docker service logs --tail 50 rastreamento-21-go_backend-rastreamento | grep APP_DIAG`
- Conta de teste do app (backend prod): CPF `085.775.907-80` / senha `160807` (veículo `TST1J16`).
- Apple: Team `CCMH2N6PS4`, app id ASC `6785540839`, conta `marketing21goprotpatri@gmail.com`.
- App **já foi rejeitado** pela App Review por: (2.1a) tela branca no iPad; (2.3.10) barra de
  status não-iOS nos screenshots [já corrigido nos screenshots]; (2.1) 7 perguntas de negócio
  [resposta pronta]. **A tela branca é o bloqueador principal.**
```

---

## 13. RESULTADO FASE 1 — CONFIRMADO (04/07/2026)

**Aparelho de teste:** iPhone 13 Pro (chip A15). **Versão do iOS: 26.5** (confirmada pelo dono
em 04/07/2026). → iOS 26.x + build Release + New Architecture = cenário exato do expo#44925 /
facebook/react-native#54859. **Diagnóstico upstream fechado.**

**Procedimento:** dono atualizou/abriu o **build 13** no TestFlight (só aparecia "Abrir",
sem "Atualizar" → já estava no build mais recente; tester `marketing21goprotpatri@gmail.com`
consta como `INSTALLED` no grupo, confirmado via ASC API). Deixou o app ~10s na tela branca.

**Leitura dos logs do servidor (`grep APP_DIAG`):**
- Endpoint `/diag` **vivo e logando** — teste `curl-check-0704` apareceu no mesmo segundo.
- Hora do servidor no teste: `2026-07-04 12:48 UTC`.
- Na janela de 90 min em torno da abertura do app: **NENHUM ping do build 13**. Nem
  `01-module-loaded` (que roda na primeiríssima linha de JS, antes de qualquer render).

**VEREDITO:** o **JavaScript não executa** no build de produção iOS. O boot trava na camada
nativa **antes** de avaliar o bundle Hermes. Isso **confirma o diagnóstico upstream**
(expo#44925 — `RCTHost` nunca inicializa o runtime; sem crash log). Encerrada a era de
correções em JS. Segue para **Fase 2 (mitigação nativa), uma mudança por build**.

---

## 14. FASE 2 — TENTATIVAS DE MITIGAÇÃO (log por build)

### Build A (build 14) — atualizar patches do SDK 56 — **FALHOU**
- **Mudança:** `npx expo install expo@^56 --fix` → expo 56.0.12 → **56.0.14** (+ @expo/ui,
  expo-router, expo-linking, expo-splash-screen alinhados). `expo-doctor`: 20/21 checks OK
  (o único fail foi rede). Sentry **não** incluído (sintoma é hang, não crash; exige conta;
  contaminaria o teste de mudança única).
- **Teste (05/07/2026, ao vivo):** dono abriu o build 14 no iPhone 13 Pro / iOS 26.5
  (confirmado "1.0.0 (14)" no TestFlight). Tela branca. Captador de logs ao vivo + leitura
  direta desde o marco zero: **ZERO pings**. JS continua sem executar.
- **Conclusão:** os patches do SDK 56.0.14 **não resolvem**. Hipótese "patches recentes"
  eliminada com prova.

### Build B (build 15) — remover módulos nativos não usados — _em teste_
- **Mudança:** `npm uninstall @expo/ui expo-glass-effect expo-symbols expo-device
  react-native-reanimated react-native-worklets expo-image`. Confirmado por grep que **nenhum**
  é importado em `src/` (0 usos cada). Sem `babel.config.js` referenciando reanimated → remoção
  segura. Objetivo: reduzir TurboModules registrados no boot (hipótese: um módulo nativo
  experimental trava a inicialização do runtime no iOS 26).
- `diag.ts` BUILD atualizado para `'15'`.
- **Teste (05/07/2026, ao vivo):** dono abriu o build 15 (confirmado "1.0.0 (15)" no
  TestFlight). Tela branca. Captador ao vivo filtrando `b=15` + leitura direta: **ZERO pings**.
- **Conclusão:** remover módulos nativos não usados **não resolve**. JS continua sem executar.

### Build C (build 16) — remover `reactCompiler` dos experiments — _em teste_
- **Mudança:** removido `"reactCompiler": true` de `experiments` no `app.json` (mantido
  `typedRoutes`). O React Compiler é experimental e reescreve os componentes em build;
  hipótese: interfere na inicialização em produção no iOS 26.
- `diag.ts` BUILD atualizado para `'16'`.
- **Resultado:** _(aguardando build + teste no device)_

> **Nota:** Build C é a última mitigação no nível do app da Fase 2. Se falhar, confirma que o
> problema é 100% upstream (expo#44925 / RN#54859) e passamos à Fase 3 (decisão do dono:
> testar SDK 57 / RN 0.86, ou patch-package no RN). Todos os builds 14–16 mantêm o mesmo
> padrão: iPhone 13 Pro / iOS 26.5, tela branca, zero pings — JS nunca executa.

---

## 15. FASE OBSERVAÇÃO SEM CABO + BUILD 17 (PING NATIVO) — 05/07/2026

### Virada de diagnóstico
Pesquisa externa achou a issue **expo#44680**: builds Release SDK 55 **funcionam** em
iPhone 13 mini (chip **A15**, o mesmo do 13 Pro) com iOS 26. Logo, "bug upstream sem
solução" está **errado** — há causa específica nesta config. Regra nova: **observar antes
de mudar**, nada de build às cegas.

### Tentativa de syslog por USB — BLOQUEADA (evidência)
- Instalado `pymobiledevice3 9.33.1` no Windows (contornado: pip global com metadata
  corrompida → venv; erro de MAX_PATH no `jedi` → venv em caminho curto + instalação sem
  `IPython`, que não é usado pelos comandos `usbmux/syslog/crash`). `usbmux list` responde.
- **Apple Mobile Device Service rodando**; drivers Apple instalados (iPhone já pareou aqui
  antes — registro em `C:\ProgramData\Apple\Lockdown\00008110-001111043E9A801E.plist`,
  prefixo `00008110` = A15 = 13 Pro).
- **iPhone NÃO enumera dados no USB** (`Get-PnpDevice` sem `VID_05AC`). Carrega mas não
  passa dados = **cabo só-carga** (dono não tem outro cabo). Enumeração USB acontece no
  hardware antes do "Confiar" → ausência total = físico, não trust.
- Rede também descartada: `pymobiledevice3 remote browse` → `{usb:[], wifi:[]}` (iPhone não
  advertisa RemoteXPC; Wi-Fi sync off, e sem cabo não dá pra ativar).

### Evidência nativa que o dono conseguiu SEM cabo (.ips do próprio iPhone)
Relatório extraído via **Ajustes → Privacidade → Análise → Dados de Análise**. Fato novo:
**`Free disk space: 1556.30 MB`** — iPhone com ~1,5 GB livres de 119 GB. Variável a
eliminar antes do próximo teste (pedido ao dono: liberar 5–10 GB).

### Build 17 — ping NATIVO no AppDelegate (observação sem cabo)
Como o syslog por USB está bloqueado, movemos o `diag()` pra **camada nativa iOS**, que roda
**antes** do JavaScript. Config plugin `mobile/plugins/with-native-boot-diag.js`
(`withAppDelegate`), **somente Foundation**, fire-and-forget, nunca crasha:
- `N1-didFinishLaunching-start` — 1ª linha do `didFinishLaunchingWithOptions`
- `N2-didFinishLaunching-end` — última linha antes do `return super.application(...)`
- `N3-alive-8s` — `DispatchQueue.main.asyncAfter(+8s)` (prova de vida: se chegar, processo
  vive = **hang**, não morte)

**Validação (prebuild iOS NÃO roda no Windows — "Skipping generating the iOS native project
files"):** obtido o template **real** do AppDelegate.swift do SDK 56 (do repo `expo/expo`
branch `sdk-56`, `templates/expo-template-bare-minimum/ios/HelloWorld/AppDelegate.swift`) e
rodado teste da transformação pura do plugin: **15/15 OK** (helper injetado 1x, N1 antes de
`let delegate`, N2 antes do return, N3 em +8s, `@main` preservado, idempotente, lança erro se
âncora sumir). `expo config` exit=0, `tsc` exit=0. O plugin **lança erro** se a âncora sumir
→ build ruim falha rápido no prebuild da nuvem, não gera 40 min inúteis. Trecho gerado:

```swift
  ) -> Bool {
    // r21go native boot diag: inicio do didFinishLaunching + prova de vida em 8s
    r21goNativeDiag("N1-didFinishLaunching-start")
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
      r21goNativeDiag("N3-alive-8s")
    }
    let delegate = ReactNativeDelegate()
    ...
    // r21go native boot diag: fim do didFinishLaunching
    r21goNativeDiag("N2-didFinishLaunching-end")
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
```

**Disparo:** commit `7e6472f` (consolidou também remoções descommitadas dos builds 14–16),
`eas build --platform ios --profile production --auto-submit`. buildNumber **16 → 17**.
Build ID `0cc95301-60a4-409f-a356-48d8273254a3`. Captura ao vivo pronta:
`ssh -i ~/.ssh/claude_21go root@167.71.31.77 "docker service logs -f rastreamento-21-go_backend-rastreamento | grep APP_DIAG"`.

### Adendo — CAIXA-PRETA (crash proposital) + rebuild como build 18
O build 17 (buildNumber 17) ficou **VALID mas com 0 grupos beta vinculados** (grupo "Time
Interno" tem `hasAccessToAllBuilds=false` → cada build precisa ser adicionado explicitamente),
então não apareceu pro testador. Em vez de só corrigir isso, o dono pediu uma 2ª camada de
diagnóstico e re-buildamos tudo junto como **build 18** (número 17 já queimado; `diag BUILD='18'`,
pings `b=18`, buildNumber 18 — tudo alinhado).

**Por quê:** "Dados de Análise" só grava .ips quando o app **morre**; o nosso trava **vivo**
(sem watchdog kill até agora). Solução: converter o hang num **crash controlado** pra o iOS
gravar o relatório completo com todas as threads.

**Mecanismo (no mesmo plugin `with-native-boot-diag.js`):**
- Nativo, no `didFinishLaunching`: `UserDefaults.standard.set(false, forKey: "r21goJsBooted")`.
- JS (`diag.ts`, evento `01-module-loaded`): `Settings.set({ r21goJsBooted: true })` (RN Settings
  = NSUserDefaults). try/catch.
- Nativo, `DispatchQueue.main.asyncAfter(+25s)`: se a flag continuar `false` (JS nunca subiu) →
  ping `N4-watchdog-js-never-started` **síncrono** (DispatchSemaphore, espera até 3s pra sair
  antes do crash) → `fatalError("R21GO_DIAG_BUILD18: ...")`.
- **Efeito no device:** app abre → tela branca → **~25s → fecha sozinho** (esperado!) → iOS grava
  .ips em Ajustes → Privacidade → Dados de Análise (nome "21 Go…"/"TrackGo…", data de hoje).

Build 18 disparado: commit `36e0453`, Build ID `1338823d-ee67-4f34-9a5b-6214ca005ed6`,
buildNumber 17→18. Transformação validada por teste **24/24** contra template real SDK 56.
Próximo: vincular build 18 ao grupo "Time Interno" via ASC API (o que faltou no 17).

**Ao receber o .ips:** analisar TODAS as threads (o `fatalError` da thread que crashou é NOSSO,
proposital). O que importa é onde as OUTRAS threads estão presas — procurar
`com.facebook.react.runtime.JavaScript`, `TurboModuleManager`, `ExpoModulesCore`, `hermesvm`,
`RCTHost`, `dyld`, `keychain`/`SecureStore`. Cruzar com expo#44925 / RN#54859 antes de propor
correção.

### Interpretação (a registrar quando o teste rodar)
- **N1/N2/N3 chegam, JS (`01-module-loaded`) NÃO** → processo nativo vive; hang na
  inicialização do runtime RN/Expo (expo#44925). **Próximo já autorizado: Build 18 =
  downgrade SDK 54 + `newArchEnabled:false`** (viável: reanimated removido; boot Legacy/
  RCTBridge não passa pelo código do bug).
- **NADA chega (nem N1)** → não chega ao AppDelegate → instalação/assinatura/dyld, não RN.
  Investigar provisioning (`../secrets/profile.mobileprovision`), propor `eas credentials`.
  **NÃO fazer downgrade nesse caso.**
- **N1 chega, N2 não** → algo dentro do `didFinishLaunching` trava → isolar módulo a módulo.
- **Tudo chega + JS** → problema sumiu; validar tela de login com o dono.

**Resultado:** _(aguardando build + teste no device)_

---

## 16. VEREDITO BUILD 18 + BUILD 19 (exclusão do autolinking) — 06/07/2026

### Build 18 rodou — caixa-preta funcionou, .ips capturado sem cabo
Pings nativos recebidos (servidor, 06/07 -0300): **N1** 10:52:53, **N2** 10:52:53,
**N3** 10:53:00, **N4** 10:53:18. Ou seja: boot nativo **completo** (N1→N2), processo
**vivo aos 8s** (N3) e, aos 25s, **JS nunca marcou a flag** → watchdog → crash (N4). O dono
extraiu o `.ips` pelos Dados de Análise e colocou na raiz do projeto
(`21GoRastreamento-2026-07-06-105319.ips`).

### Análise do .ips (verificada diretamente, não só pela pesquisa externa)
- Crash = `EXC_BREAKPOINT`/`SIGTRAP`/`assertionFailure` → nosso `fatalError` do watchdog
  (proposital, thread do dispatch timer no main).
- Threads do runtime RN **existem e estão OCIOSAS**: `com.facebook.react.runtime.JavaScript`
  (`RCTJSThreadManager`), `hades`/`HadesGC`, `hermesvm`. Nenhuma travada em TurboModule/dyld/
  keychain. → **o bundle JS nunca é executado** (morre antes da 1ª linha). Padrão expo#44925.
- **SMOKING GUN (confirmado no usedImages):** `RNReanimated.framework`, `RNWorklets.framework`,
  `ExpoModulesWorklets.framework` **estão no binário** — apesar de "removidos" no build 15.
  → **o teste do Build B (15) foi INVÁLIDO.**

### Por que continuavam no binário (`npm ls`)
- `react-native-reanimated@4.3.1` ← `expo-router@56.2.13` (direto) + `react-native-drawer-layout`.
- `react-native-worklets@0.8.3` ← `@expo/ui`, `reanimated` e **`expo-modules-core@56.0.19`**.
→ Dependência transitiva de `expo-router`/`expo-modules-core`; remover do `package.json` não
tira do binário. Reanimated/worklets se plugam na subida do runtime JS — exatamente onde morre.

### Build 19 — exclusão cirúrgica do autolinking
`mobile/package.json`: `"expo": { "autolinking": { "exclude": ["react-native-reanimated",
"react-native-worklets"] } }`. Sintaxe confirmada no código do `expo-modules-autolinking@56.0.18`
(`parsePackageJsonOptions`: `exclude` no topo vale pra todas as plataformas; `findModules.js`
filtra por nome). **Validado sem build:** `expo-modules-autolinking resolve --platform apple`
lista 19 módulos, **zero** reanimated/worklets. `tsc`/`expo config` exit=0. Mantidos: pings
N1–N4, caixa-preta, `diag BUILD='19'`. buildNumber 18→19.

**Validação REAL (a checar no teste):** não é o package.json nem o resolve — é o **binário**. Se
o 19 travar, o próximo `.ips` da caixa-preta **tem que** mostrar `usedImages` SEM RNReanimated/
RNWorklets. Só então a hipótese reanimated estará descartada de verdade, liberando o **Build 20
= SDK 54 + `newArchEnabled:false`**.

**Resultado build 19 (06/07, teste ~11:32 -0300):** pings **N1** 14:32:31, **N2** 14:32:31,
**N3** 14:32:35, **N4** 14:32:53 (UTC) — MESMO padrão do 18: JS nunca roda, watchdog crashou.
**Prova de binário (baixei o IPA e listei Frameworks):** `RNReanimated.framework` e
`RNWorklets.framework` **REMOVIDOS** ✅; `ExpoModulesWorklets.framework` continua (é parte do
`expo-modules-core`, não do pacote excluído). → **Reanimated/worklets DESCARTADOS como causa**
(comprovadamente fora do binário e o hang persiste). Libera o Build 20.

---

## 17. BUILD 20 — SDK 54 + Legacy Architecture (newArchEnabled:false) — 06/07/2026

Reanimated/worklets descartados com prova de binário. Boot nativo saudável, JS nunca sobe
(expo#44925 / RN#54859, New Architecture no iOS 26). Última mitigação no nível do app:
**downgrade Expo SDK 56→54 + `newArchEnabled:false`** — caminho de boot Legacy `RCTBridge`,
fora da rota do bug do RSDHost/New Arch. Viável: reanimated (que exigia New Arch) já removido.
diag `BUILD='20'`, pings N1–N4 + caixa-preta mantidos; plugin re-ancorado pro AppDelegate do
SDK 54. `npx expo install --fix` + `tsc`.

**Resultado:** _(em implementação)_

_(fim da auditoria)_
