# App 21 Tracker — paridade por público e bugs do Android · Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android e iOS servindo o mesmo binário sem crash no boot e sem login falso-negativo; associado vê só localização e dados próprios; time interno tem 100% do painel dentro da WebView com botão Voltar funcionando; regra "associado nunca vê função interna" vira teste que falha.

**Architecture:** Dois mundos já existentes no app Expo (`mobile/`): associado (telas nativas + `/app/*`) e interno (WebView do `trackgo.site` com sessão injetada). Fase 1 corrige a causa estrutural do crash Android (MapView sem chave do Google), a mensagem de login e o documento PJ, e publica. Fase 2 acaba a WebView (Voltar físico), audita o painel a 390px e blinda o contrato `/app/*` no backend com allowlist de campos.

**Tech Stack:** Expo SDK 54 (`newArchEnabled: false`), expo-router 6, react-native-maps 1.20.1, react-native-webview 13.15, zustand, jest-expo; backend NestJS 11 + Prisma (jest); GitHub Actions (`android.yml`, `ios.yml`) com `eas build --local`; puppeteer-core pra auditoria visual.

## Global Constraints

- **Regra absoluta:** função de time interno (instalar, IMEI, local de instalação, estoque, pendências, rota, técnico, chips, usuários, relatórios) **nunca** chega ao associado. Técnico é time interno e entra **só por e-mail**. Nenhuma tarefa cria terceiro mundo de login.
- Roteamento de login inalterado: CPF/CNPJ → associado; e-mail → interno (`mobile/src/lib/login-router.ts`).
- `newArchEnabled: false` permanece (New Arch trava o boot no iOS 26).
- Nunca commitar segredo: chave do Google Maps Android vem de secret do GitHub (`GOOGLE_MAPS_ANDROID_KEY`), nunca literal em `app.json`.
- Commits em português, formato `tipo(escopo): descrição`, com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Spec: `docs/superpowers/specs/2026-08-21-app-paridade-e-bugs-android-design.md`.
- Testes do mobile: `cd mobile && npx jest <arquivo>`; do backend: `cd backend && npx jest <arquivo>`.
- Produção: antes de qualquer deploy de backend, conferir `curl -s -o /dev/null -w "%{http_code}" https://api.trackgo.site/api/v1/health` → 200, e repetir depois.

---

## Fase 1 — bugs + publicação

### Task 1: Evidência antes de mexer (Play ao vivo, logs de login, SHA-1)

**Files:**
- Create: `docs/superpowers/plans/evidencia-2026-08-21.md` (rascunho local, **não commitar**; vira seção do SessionLog no fim)

**Interfaces:**
- Produces: `versionCode` servido pela Play, contagem de logins bloqueados por "sem rastreador instalado", SHA-1 do certificado de upload (usado na Task 2).

- [x] **Step 1: Pedir ao dono o print da Play com a versão ao vivo**

Mensagem exata pro dono: "Abra a página do 21 Tracker na Play Store no celular → 'Sobre este app' → role até 'Versão'. Me manda o print ou o texto." Registrar no rascunho: `Play: versão X.Y.Z`. Se o dono tiver acesso ao Play Console: print de *Versões → Produção → versionCode*.

- [x] **Step 2: Contar logins bloqueados no backend (últimos 7 dias)**

```bash
ssh root@167.71.31.77 'CID=$(docker ps -q -f name=backend-rastreamento | head -1); docker logs --since 168h "$CID" 2>&1 | grep -c "Login bloqueado (sem rastreador instalado)"'
```
Esperado: um inteiro. Anotar. Se > 0, o sintoma "CPF + senha=CPF não entra" tem pelo menos essa causa parcial (mensagem engolida pelo app — Task 3).

- [x] **Step 3: Contar quem conseguiu logar nos últimos 7 dias**

```bash
ssh root@167.71.31.77 'PG=$(docker ps -q -f name=postgres-rastreamento | head -1); docker exec "$PG" psql -U postgres -d rastreamento -tAc "select count(*) from associates where last_login_at > now() - interval '"'"'7 days'"'"'"'
```
Esperado: um inteiro. Anotar. (Se o nome do banco/usuário divergir, conferir com `docker exec "$PG" psql -U postgres -lqt`.)

- [x] **Step 4: SHA-1 do keystore de upload (pra restringir a chave do Google)**

Local, com o keystore que está no secret `ANDROID_KEYSTORE_BASE64` (pedir ao dono o `.jks` ou decodificar o secret num runner). Se tiver o arquivo em mãos:
```bash
keytool -list -v -keystore upload-keystore.jks -alias "$ALIAS" | grep -E "SHA1|SHA-1"
```
Esperado: `SHA1: AA:BB:...`. **Também** pedir ao dono o print de *Play Console → Configuração → Integridade do app → Chave de assinatura do app → SHA-1* — a Play reassina o binário, e é esse certificado que vale em produção. Anotar os dois.

- [x] **Step 5: Registrar o rascunho**

Escrever em `docs/superpowers/plans/evidencia-2026-08-21.md` as quatro respostas, com data e comando usado. Não commitar (adicionar ao `.git/info/exclude` se precisar: `echo docs/superpowers/plans/evidencia-2026-08-21.md >> .git/info/exclude`).

---

### Task 2: Chave do Google Maps no Android via `app.config.js` + secret no workflow

**Files:**
- Create: `mobile/app.config.js`
- Create: `mobile/app.config.test.js`
- Modify: `.github/workflows/android.yml` (step "Build")
- Modify: `docs/DEPLOY.md` (tabela de credenciais — só o **nome**)

**Interfaces:**
- Consumes: SHA-1 da Task 1 (restrição da chave no GCP).
- Produces: `android.config.googleMaps.apiKey` preenchido no manifesto do build Android; build Android **falha** se a chave faltar (em vez de gerar binário que cai).

- [x] **Step 1: Escrever o teste que falha**

`mobile/app.config.test.js`:
```js
/**
 * O Android do react-native-maps usa o Google Maps SDK e cai ao montar o MapView
 * sem chave. A chave não pode ficar literal no app.json (segredo no repo), então
 * entra por variável de ambiente no momento do build.
 */
const carregar = () => {
  jest.resetModules();
  return require('./app.config.js');
};

describe('app.config.js', () => {
  const antes = { ...process.env };
  afterEach(() => {
    process.env = { ...antes };
  });

  it('injeta a chave do Google Maps no Android a partir do ambiente', () => {
    process.env.GOOGLE_MAPS_ANDROID_KEY = 'AIza-teste';
    const cfg = carregar()({ config: { android: { package: 'com.r21go.client' } } });
    expect(cfg.android.config.googleMaps.apiKey).toBe('AIza-teste');
    expect(cfg.android.package).toBe('com.r21go.client');
  });

  it('num build EAS de Android sem a chave, derruba o build em vez de gerar binário que cai', () => {
    delete process.env.GOOGLE_MAPS_ANDROID_KEY;
    process.env.EAS_BUILD = 'true';
    process.env.EAS_BUILD_PLATFORM = 'android';
    expect(() => carregar()({ config: { android: {} } })).toThrow(/GOOGLE_MAPS_ANDROID_KEY/);
  });

  it('fora de build (expo start) sem chave só avisa e segue', () => {
    delete process.env.GOOGLE_MAPS_ANDROID_KEY;
    delete process.env.EAS_BUILD;
    const cfg = carregar()({ config: { android: {} } });
    expect(cfg.android.config.googleMaps.apiKey).toBe('');
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

Run: `cd mobile && npx jest app.config.test.js`
Expected: FAIL — `Cannot find module './app.config.js'`.

- [x] **Step 3: Implementar `mobile/app.config.js`**

```js
/**
 * Complementa o app.json em tempo de build. Só mexe no que não pode ser
 * estático: a chave do Google Maps do Android (react-native-maps no Android
 * usa o Google Maps SDK; sem chave o Play Services derruba o processo ao
 * montar o MapView — com sessão salva o app reabre no mapa e cai de novo).
 * iOS usa Apple Maps e não precisa de nada.
 */
module.exports = ({ config }) => {
  const chave = process.env.GOOGLE_MAPS_ANDROID_KEY ?? '';
  const buildAndroid =
    process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PLATFORM === 'android';

  if (!chave && buildAndroid) {
    throw new Error(
      'GOOGLE_MAPS_ANDROID_KEY ausente: build Android geraria um app que cai ao abrir o mapa.',
    );
  }
  if (!chave) {
    console.warn('[app.config] GOOGLE_MAPS_ANDROID_KEY vazia — mapa Android não vai renderizar.');
  }

  return {
    ...config,
    android: {
      ...config.android,
      config: {
        ...(config.android?.config ?? {}),
        googleMaps: { apiKey: chave },
      },
    },
  };
};
```

- [x] **Step 4: Rodar e ver passar**

Run: `cd mobile && npx jest app.config.test.js`
Expected: PASS (3 testes).

- [x] **Step 5: Conferir que o Expo lê o `app.config.js` junto do `app.json`**

Run: `cd mobile && GOOGLE_MAPS_ANDROID_KEY=teste npx expo config --type prebuild --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s);console.log(c.android.config.googleMaps.apiKey, c.android.package, c.newArchEnabled)})"`
Expected: `teste com.r21go.client false`.

- [x] **Step 6: Criar a chave no GCP (ação do dono, com doc oficial lida antes)**

Antes de instruir, **WebFetch** de `https://developers.google.com/maps/documentation/android-sdk/get-api-key` e `https://cloud.google.com/docs/authentication/api-keys#adding-application-restrictions` — não chutar fluxo de UI. Resumo do que a doc pede (confirmar na leitura): projeto GCP `21go-maps` (já existe, ver `docs/DEPLOY.md`) → ativar **Maps SDK for Android** → criar chave → restrição de aplicativo **Apps Android** com pacote `com.r21go.client` + os **dois** SHA-1 da Task 1 (upload e app signing da Play) → restrição de API **só Maps SDK for Android**. Dono cola a chave no 1Password e no GitHub: *Settings → Secrets and variables → Actions → New repository secret* `GOOGLE_MAPS_ANDROID_KEY`.

- [x] **Step 7: Passar o secret pro build no workflow**

Em `.github/workflows/android.yml`, no step `Build (local, sem cota EAS nuvem)`, o bloco `env:` vira:
```yaml
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
          GOOGLE_MAPS_ANDROID_KEY: ${{ secrets.GOOGLE_MAPS_ANDROID_KEY }}
          PROFILE: ${{ inputs.profile }}
```

- [x] **Step 8: Documentar o nome da credencial**

Em `docs/DEPLOY.md`, na tabela da seção "Satélite do Google (Map Tiles API)" (linha ~119), adicionar a linha:
```
| `GOOGLE_MAPS_ANDROID_KEY` | GitHub Actions (secret) | sim, pro build Android | Chave do GCP `21go-maps` com **Maps SDK for Android**, restrita ao pacote `com.r21go.client` + SHA-1 de upload e de assinatura da Play. Sem ela o `app.config.js` derruba o build. |
```

- [x] **Step 9: Commit**

```bash
git add mobile/app.config.js mobile/app.config.test.js .github/workflows/android.yml docs/DEPLOY.md
git commit -m "fix(android): chave do Google Maps entra no build — sem ela o app caía ao abrir o mapa

react-native-maps no Android usa o Google Maps SDK; sem chave o Play Services
derruba o processo ao montar o MapView. Com sessão salva o app reabria direto
no mapa e caía de novo (o \"abre e fecha sozinho\" relatado). iOS usa Apple Maps
e nunca sofreu. A chave vem de secret do GitHub via app.config.js; build
Android sem ela falha em vez de gerar binário quebrado.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Login mostra a causa real quando falta rastreador vinculado

**Files:**
- Modify: `mobile/src/lib/login-error.ts`
- Test: `mobile/src/lib/login-error.test.ts`

**Interfaces:**
- Consumes: backend já responde `401` com `message: 'Nenhum rastreador instalado vinculado ao seu CPF. Fale com a sua associação.'` (`backend/src/modules/app/associate-auth.service.ts:152`). Esse 401 só acontece **depois** de a senha bater — não é vetor de enumeração.
- Produces: `explicarFalhaDeLogin(erro, autenticou)` devolve `{titulo:'Sem rastreador vinculado', texto:<mensagem do servidor>}` para esse caso; todo outro 401 segue genérico.

- [x] **Step 1: Escrever o teste que falha**

Adicionar em `mobile/src/lib/login-error.test.ts`, dentro do `describe`:
```ts
  it('401 por falta de rastreador instalado mostra a orientação do servidor, não "senha inválida"', () => {
    const r = explicarFalhaDeLogin(
      {
        response: {
          status: 401,
          data: {
            message:
              'Nenhum rastreador instalado vinculado ao seu CPF. Fale com a sua associação.',
          },
        },
      },
      false,
    );
    expect(r.titulo).toBe('Sem rastreador vinculado');
    expect(r.texto).toContain('Fale com a sua associação');
    expect(r.texto).not.toContain('senha');
  });

  it('401 com qualquer outra mensagem continua genérico (não vira verificador de CPF)', () => {
    const r = explicarFalhaDeLogin(
      { response: { status: 401, data: { message: 'Associado não encontrado' } } },
      false,
    );
    expect(r.texto).toContain('CPF/e-mail ou senha inválidos');
  });
```

- [x] **Step 2: Rodar e ver falhar**

Run: `cd mobile && npx jest src/lib/login-error.test.ts`
Expected: FAIL no primeiro teste novo (`titulo` é "Não foi possível entrar").

- [x] **Step 3: Implementar**

Em `mobile/src/lib/login-error.ts`, substituir o bloco `if (status === 401) {...}` por:
```ts
  const status = erro?.response?.status;
  if (status === 401) {
    // Caso único em que o servidor diz mais: a senha JÁ bateu, mas o cadastro
    // não tem rastreador instalado. Repassar isso não revela nada a quem não
    // tem a senha, e sem isso o cliente acha que errou a senha e tenta de novo
    // pra sempre.
    const mensagem = mensagemDoServidor(erro);
    if (mensagem.includes('Nenhum rastreador instalado')) {
      return { titulo: 'Sem rastreador vinculado', texto: mensagem };
    }
    return {
      titulo: 'Não foi possível entrar',
      texto: 'CPF/e-mail ou senha inválidos. Confira e tente de novo.',
    };
  }
```
E adicionar no fim do arquivo:
```ts
/** NestJS manda `message` como string ou array de strings (class-validator). */
function mensagemDoServidor(erro: any): string {
  const m = erro?.response?.data?.message;
  if (Array.isArray(m)) return m.join(' ');
  return typeof m === 'string' ? m : '';
}
```

- [x] **Step 4: Rodar e ver passar**

Run: `cd mobile && npx jest src/lib/login-error.test.ts`
Expected: PASS (7 testes).

- [x] **Step 5: Commit**

```bash
git add mobile/src/lib/login-error.ts mobile/src/lib/login-error.test.ts
git commit -m "fix(app): login diz quando falta rastreador vinculado em vez de culpar a senha

O backend já distinguia os dois 401; o app colapsava tudo em \"senha inválida\".
Só esse caso é repassado (a senha já bateu) — os outros seguem genéricos.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Perfil mostra CNPJ inteiro (associado PJ)

**Files:**
- Modify: `mobile/src/app/(tabs)/profile.tsx:15,57`
- Test: `mobile/src/lib/documento.test.ts` (já cobre `maskDocumento`; conferir)

- [x] **Step 1: Confirmar que `maskDocumento` já tem teste de CNPJ**

Run: `cd mobile && grep -n "14\|CNPJ\|/0001-" src/lib/documento.test.ts`
Expected: ao menos uma linha. Se não houver, adicionar ao `describe` existente:
```ts
  it('mascara CNPJ com 14 dígitos sem cortar', () => {
    expect(maskDocumento('49410571000193')).toBe('49.410.571/0001-93');
  });
```
e rodar `npx jest src/lib/documento.test.ts` → PASS.

- [x] **Step 2: Trocar o import e o uso**

Em `mobile/src/app/(tabs)/profile.tsx`:
- linha 15: `import { maskCpf } from '@/lib/format';` → `import { maskDocumento } from '@/lib/format';`
- linha 57: `<Row icon="card-outline" label="CPF" value={maskCpf(profile.cpf)} />` → `<Row icon="card-outline" label={profile.cpf.replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF'} value={maskDocumento(profile.cpf)} />`

- [x] **Step 3: Tipos e testes**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: sem erro de tipo; todos os testes PASS.

- [x] **Step 4: Commit**

```bash
git add "mobile/src/app/(tabs)/profile.tsx" mobile/src/lib/documento.test.ts
git commit -m "fix(app): perfil do associado pessoa juridica mostrava CNPJ cortado como CPF

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Versão 1.3.1, teste no aparelho, build e publicação nas duas lojas

**Files:**
- Modify: `mobile/app.json` (`version`, `ios.buildNumber`, `android.versionCode`)

**Interfaces:**
- Consumes: Tasks 2–4 commitadas; secret `GOOGLE_MAPS_ANDROID_KEY` criado.
- Produces: App Store e Play servindo **1.3.1**.

- [x] **Step 1: Subir versão**

Em `mobile/app.json`: `"version": "1.3.1"`, `"buildNumber": "32"`, `"versionCode": 4`.
```bash
git add mobile/app.json
git commit -m "chore(mobile): versao 1.3.1 — mapa Android com chave, login explicativo, CNPJ no perfil

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

- [x] **Step 2: Build `preview` (.apk) pra testar no aparelho antes da Play**

Sem `gh` local: dono dispara em *GitHub → Actions → Build Android → Run workflow → profile = preview*. Baixar artefato `app-android-preview`, instalar num Android (`adb install app.apk` ou transferir e abrir).

- [x] **Step 3: Reproduzir os dois sintomas no aparelho**

1. Login com CPF + senha=CPF de um associado **com rastreador instalado** → deve entrar e abrir o mapa.
2. Fechar o app pelo gesto e reabrir 3 vezes → deve abrir no mapa e **ficar aberto**.
3. Login com CPF de associado **sem** rastreador → deve mostrar "Sem rastreador vinculado".
Se cair em qualquer ponto, coletar:
```bash
adb logcat -b crash -d > crash.txt; adb logcat -d | grep -E "AndroidRuntime|FATAL|com.r21go.client" | tail -80
```
e voltar pra Task 2 (se a mensagem tiver `API key not found` / `Google Maps Android API`, a chave não entrou no manifesto: conferir `unzip -p app.apk AndroidManifest.xml | strings | grep -i geo.API_KEY`).

- [x] **Step 4: Build `production` Android e iOS**

Actions → *Build Android* → `production` (gera `.aab`); Actions → *Build iOS* (gera `.ipa`). Aguardar os dois (≤ 90 min cada).

- [x] **Step 5: Publicar**

- Play: dono envia o `.aab` em *Produção → Criar nova versão*, notas: "Correção do fechamento inesperado no Android ao abrir o mapa; mensagem de acesso mais clara; dados de empresa no perfil." Seguir `mobile/store/play/PUBLICACAO-PASSO-A-PASSO.md`.
- iOS: `cd mobile && eas submit --platform ios --profile production --path <caminho do .ipa>` (credenciais em `eas.json`/`secrets/`), depois *App Store Connect → enviar pra revisão*.

- [x] **Step 6: Verificar com evidência (não presumir)**

```bash
curl -s "https://itunes.apple.com/lookup?bundleId=com.r21go.client&country=br" | grep -o '"version":"[^"]*"'
curl -s -A "Mozilla/5.0" "https://play.google.com/store/apps/details?id=com.r21go.client&hl=pt_BR" | grep -o -E '"1\.[0-9]\.[0-9]"' | sort -u
```
Expected (após propagação, Apple pode levar 24h+ de revisão): `"version":"1.3.1"` e `"1.3.1"`. Registrar data/hora da verificação no SessionLog.

---

## Fase 2 — WebView interna acabada + associado blindado

> Execução 21/08: Task 8 auditou as 19 rotas em produção e todas já passavam a 390px — nenhum commit de frontend. Revisão final acrescentou allowlist em `/app/alerts` e `/app/me`, assert do secret no workflow, reset do `podeVoltar` no "Tentar de novo", texto sem "CPF" pra associado PJ e recuperação de senha aceitando CNPJ.

### Task 6: Botão Voltar físico do Android navega dentro do painel

**Files:**
- Modify: `mobile/src/app/interno/painel.tsx`

**Interfaces:**
- Produces: Voltar → `webView.goBack()` enquanto houver histórico; sem histórico, comportamento padrão do sistema (sai do app).

- [x] **Step 1: Implementar**

Em `mobile/src/app/interno/painel.tsx`:
- imports: `import { useEffect, useRef, useState } from 'react';` e adicionar `BackHandler` ao import de `react-native`.
- dentro do componente, após `const [tentativaChave, ...]`:
```tsx
  const webRef = useRef<WebView>(null);
  const podeVoltar = useRef(false);

  // Voltar físico do Android: volta uma página do painel, não fecha o app.
  // Só quando o histórico acaba é que o sistema assume (e aí sair é o certo).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (podeVoltar.current) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);
```
- no `<WebView`: adicionar `ref={webRef}` e, dentro do `onNavigationStateChange` existente, a primeira linha `podeVoltar.current = nav.canGoBack;` (antes do `if (ehLoginDoPainel(nav.url)) sair();`).

- [x] **Step 2: Tipos**

Run: `cd mobile && npx tsc --noEmit`
Expected: sem erro.

- [x] **Step 3: Verificação manual (Android, `expo start --android` ou o .apk preview)**

Login interno por e-mail → Estoque → abrir um item → Voltar físico → volta pro Estoque (app continua aberto) → Voltar até o início → Voltar de novo → app vai pro fundo. Registrar no SessionLog "verificado em <aparelho>".

- [x] **Step 4: Commit**

```bash
git add mobile/src/app/interno/painel.tsx
git commit -m "feat(app): voltar fisico do Android navega no painel em vez de fechar o app

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Contrato `/app/*` nunca vaza campo interno (a regra vira teste)

**Files:**
- Create: `backend/src/modules/app/app-data.contrato.spec.ts`
- Modify: `backend/src/modules/app/app-data.service.ts:39-87`

**Interfaces:**
- Produces: `toVehicleDto(v)` — allowlist explícita `{id, plate, vehicleType, brand, model, color, year, status, traccarDeviceId}`; `getVehicles` nunca espalha o registro do Prisma. Campos proibidos na resposta do associado: `imei`, `installLocation`, `installedAt`, `technicianId`, `technician`, `serialNumber`, `stockItem*`, `device`, `deviceId`.

- [x] **Step 1: Escrever o teste que falha**

`backend/src/modules/app/app-data.contrato.spec.ts`:
```ts
/**
 * Regra absoluta (dono, 21/08/2026): função de time interno NUNCA chega ao
 * associado. IMEI + local de instalação é mapa pra sabotagem. O `select` do
 * Prisma protege hoje, mas um `...spread` no serviço faria qualquer coluna nova
 * vazar — este teste simula o Prisma devolvendo o registro gordo e exige que
 * a resposta continue enxuta.
 */
import { AppDataService } from './app-data.service';

const PROIBIDOS = [
  'imei',
  'installLocation',
  'installedAt',
  'technicianId',
  'technician',
  'serialNumber',
  'stockItemId',
  'stockItem',
  'device',
  'deviceId',
];

const veiculoGordo = {
  id: 'v1',
  plate: 'ABC1D23',
  vehicleType: 'CAR',
  brand: 'Fiat',
  model: 'Argo',
  color: 'Prata',
  year: 2022,
  status: 'ACTIVE',
  traccarDeviceId: 7,
  // tudo abaixo é interno e não pode sair
  imei: '860000000000001',
  installLocation: 'Atrás do painel, lado esquerdo',
  installedAt: new Date(),
  technicianId: 't1',
  technician: { name: 'Fulano' },
  serialNumber: 'SN1',
  stockItemId: 's1',
  device: { imei: '860000000000001' },
  deviceId: 'd1',
};

function servico(vehicles: any[]) {
  const prisma: any = {
    vehicle: { findMany: jest.fn().mockResolvedValue(vehicles) },
    alert: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const traccar: any = {
    getPositions: jest.fn().mockResolvedValue([]),
    getDevices: jest.fn().mockResolvedValue([]),
  };
  return new AppDataService(prisma, traccar);
}

function chaves(obj: any): string[] {
  return Object.keys(obj ?? {});
}

describe('contrato do associado — /app/vehicles', () => {
  it('com rastreador vinculado, nenhum campo interno sai na resposta', async () => {
    const r = await servico([veiculoGordo]).getVehicles('a1', 'tn1');
    for (const k of PROIBIDOS) expect(chaves(r[0])).not.toContain(k);
    expect(chaves(r[0]).sort()).toEqual(
      ['brand', 'color', 'connection', 'id', 'model', 'plate', 'position', 'status', 'traccarDeviceId', 'vehicleType', 'year'].sort(),
    );
  });

  it('sem rastreador vinculado (traccarDeviceId null), idem', async () => {
    const r = await servico([{ ...veiculoGordo, traccarDeviceId: null }]).getVehicles('a1', 'tn1');
    for (const k of PROIBIDOS) expect(chaves(r[0])).not.toContain(k);
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest src/modules/app/app-data.contrato.spec.ts`
Expected: FAIL — `imei` presente (o serviço usa `...v`).

- [x] **Step 3: Implementar a allowlist**

Em `backend/src/modules/app/app-data.service.ts`, logo após `toPositionDto`, adicionar:
```ts
/**
 * Allowlist do que o associado pode ver do próprio veículo. Nunca espalhar o
 * registro do Prisma aqui: IMEI, local de instalação, técnico e estoque são
 * função de time interno e não saem por /app/* em hipótese nenhuma.
 */
function toVehicleDto(v: {
  id: string;
  plate: string;
  vehicleType: unknown;
  brand: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  status: unknown;
  traccarDeviceId: number | null;
}) {
  return {
    id: v.id,
    plate: v.plate,
    vehicleType: v.vehicleType,
    brand: v.brand,
    model: v.model,
    color: v.color,
    year: v.year,
    status: v.status,
    traccarDeviceId: v.traccarDeviceId,
  };
}
```
E em `getVehicles` trocar os dois `...v`:
- `return vehicles.map((v) => ({ ...v, position: null, connection: null }));` → `return vehicles.map((v) => ({ ...toVehicleDto(v), position: null, connection: null }));`
- no `return vehicles.map((v) => { ... return { ...v, position: ..., connection: ... } })` → `return { ...toVehicleDto(v), position: ..., connection: ... }`.

- [x] **Step 4: Rodar e ver passar (e o resto do módulo)**

Run: `cd backend && npx jest src/modules/app`
Expected: PASS em todos.

- [x] **Step 5: Commit**

```bash
git add backend/src/modules/app/app-data.service.ts backend/src/modules/app/app-data.contrato.spec.ts
git commit -m "test(app): contrato do associado nunca devolve IMEI, instalacao, tecnico ou estoque

Regra absoluta do dono. O select do Prisma protegia, mas o servico espalhava o
registro — qualquer coluna nova vazaria. Agora a resposta e uma allowlist e o
teste simula o Prisma devolvendo o registro inteiro.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [x] **Step 6: Deploy do backend (fluxo real do projeto) e verificação**

Baseline: `curl -s -o /dev/null -w "%{http_code}\n" https://api.trackgo.site/api/v1/health` → 200. Depois, via SSH no droplet, build + tag + push pro registry `localhost:5000` + `docker service update` conforme `docs/DEPLOY.md` (ver memória `feedback_deploy_via_registry`; **nunca** build de backend e frontend em paralelo). Conferir `curl -s https://api.trackgo.site/api/v1/health | grep -o '"gitSha":"[^"]*"'` = SHA do commit.

---

### Task 8: Painel a 390px — nenhuma rota com rolagem horizontal

**Files:**
- Create (local, não commitar): `C:\Users\damas\AppData\Local\Temp\claude\...\scratchpad\auditoria-390.js`
- Modify: páginas de `frontend/dashboard/src/app/(dashboard)/**/page.tsx` (e componentes que elas usam) cuja auditoria acusar overflow

**Interfaces:**
- Consumes: credencial de um usuário interno de teste (env `AUD_EMAIL`/`AUD_SENHA`, nunca no script).
- Produces: lista `rota → scrollWidth/clientWidth` e correções.

- [x] **Step 1: Script de auditoria (puppeteer-core com Chrome local — ver memória `reference_puppeteer_test`)**

```js
const puppeteer = require('puppeteer-core');
const ROTAS = ['/dashboard','/mapa','/dispositivos','/veiculos','/alertas','/geofencing','/relatorios','/relatorios/condutores','/clientes','/chips','/estoque','/estoque/mapa','/etiquetas-ble','/pendencias','/rotas','/tecnicos','/usuarios','/manutencao','/configuracoes'];
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto('https://trackgo.site/login', { waitUntil: 'networkidle2' });
  await page.type('input[type=email]', process.env.AUD_EMAIL);
  await page.type('input[type=password]', process.env.AUD_SENHA);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.keyboard.press('Enter')]);
  for (const r of ROTAS) {
    await page.goto('https://trackgo.site' + r, { waitUntil: 'networkidle2' });
    await new Promise((res) => setTimeout(res, 1500));
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    console.log(`${m.sw > m.cw ? 'OVERFLOW' : 'ok      '} ${r} ${m.sw}/${m.cw}`);
    if (m.sw > m.cw) await page.screenshot({ path: `aud${r.replace(/\//g, '_')}.png`, fullPage: true });
  }
  await browser.close();
})();
```
Run: `cd <scratchpad> && npm i puppeteer-core@latest >/dev/null && AUD_EMAIL=... AUD_SENHA=... node auditoria-390.js`
Expected: uma linha por rota. Anotar as `OVERFLOW`.

- [x] **Step 2: Corrigir cada rota com OVERFLOW**

Regra mecânica, uma rota por vez, olhando o PNG: (a) toda `<Table>`/`<table>` fica dentro de `<div className="overflow-x-auto">` (padrão já usado nas 7 páginas que passam — ex.: `grep -rn overflow-x-auto "frontend/dashboard/src/app/(dashboard)"`); (b) grids fixas `grid-cols-N` ganham `grid-cols-1 md:grid-cols-N`; (c) larguras fixas `w-[NNNpx]` em contêiner de página viram `w-full max-w-[NNNpx]`. Não tocar em rota que passou.

- [x] **Step 3: Rodar a auditoria de novo até zerar**

Run: mesmo comando do Step 1.
Expected: todas `ok`.

- [x] **Step 4: Commit + deploy do frontend**

```bash
git add "frontend/dashboard/src"
git commit -m "fix(dashboard): painel sem rolagem horizontal a 390px — base da WebView do app

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Deploy do frontend conforme `docs/DEPLOY.md` (build args `NEXT_PUBLIC_API_URL`/`WS_URL`/`TRACCAR_URL` obrigatórios — memória `reference_frontend_build_args`), **depois** de o backend da Task 7 terminar (nunca em paralelo). Verificar: `curl -s -o /dev/null -w "%{http_code}" https://trackgo.site/login` → 200; rodar a auditoria uma última vez contra produção. Apagar script e PNGs.

---

### Task 9: Encerramento (Regra 3) — SessionLog, memória e spec

**Files:**
- Create: `<vault>/ClaudeCode/SessionLogs/2026-08-21-21Go-Rastreamento-app-paridade-bugs-android.md`
- Modify: `<vault>/ClaudeCode/Memoria/MEMORIA-21Go-Rastreamento.md` (Estado atual / Em andamento)
- Modify: `<vault>/ClaudeCode/Index.md` (Sessões recentes)
- Create: `<vault>/ClaudeCode/Aprendizados/Android-MapView-sem-chave-Google-derruba-o-app.md`

- [x] **Step 1: SessionLog com frontmatter (`data`, `projeto`, `tags`, `tipo: sessao`)** contendo: contexto, o que foi feito (Tasks 1–8), arquivos, decisões (chave via `app.config.js`; allowlist no `/app/vehicles`), evidências da Task 1 e da Task 5 (versões por `curl`), pendências, próximos passos, wikilinks.
- [x] **Step 2: Aprendizado** com problema / causa-raiz / solução / como evitar (o crash loop Android por MapView sem chave; iOS imune por Apple Maps).
- [x] **Step 3: Atualizar MEMORIA e Index.**
- [x] **Step 4: Commit da spec e do plano**

```bash
git add docs/superpowers/specs/2026-08-21-app-paridade-e-bugs-android-design.md docs/superpowers/plans/2026-08-21-app-paridade-e-bugs-android.md
git commit -m "docs(app): spec e plano — paridade por publico e bugs do Android

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```
