# 21Go! Cliente — App do Associado (iOS)

App mobile para o associado logar (CPF + senha) e acompanhar a localização do
veículo em tempo real, ver histórico de trajeto e alertas.

- **Stack:** Expo SDK 56 + Expo Router + React Native 0.85 + react-native-maps (Apple Maps no iOS).
- **Bundle ID:** `com.r21go.client`
- **Backend:** consome `https://api.trackgo.site/api/v1` nos endpoints `/app/*`.
- **Sem permissão de localização** do aparelho — mostramos só o carro, o que simplifica a aprovação na Apple.

## Rodar em desenvolvimento

Mapa nativo (react-native-maps) **não roda no Expo Go** — precisa de dev build:

```bash
cd mobile
npm install
# Em um Mac (ou via EAS) gerar o dev client:
npx expo run:ios            # exige Xcode / macOS
# ou um dev build na nuvem:
eas build -p ios --profile development
```

Para apontar pra um backend local em vez de produção:

```bash
EXPO_PUBLIC_API_URL=http://SEU_IP:3001/api/v1 npx expo start
```

## Pré-requisitos pra publicar

1. Conta **Apple Developer** ativa (já temos).
2. `npm i -g eas-cli` e `eas login` (conta Expo).
3. App criado no **App Store Connect** (nome, bundle `com.r21go.client`).

## Build + envio (EAS — não precisa de Mac)

```bash
cd mobile
eas build:configure          # cria o projectId (grava em app.json > extra.eas)
eas build -p ios --profile production   # build na nuvem; EAS gerencia signing/certs
eas submit -p ios --latest   # envia o .ipa pro App Store Connect / TestFlight
```

Antes do `submit`, preencher em `eas.json > submit.production.ios`:
`appleId`, `ascAppId` (ID do app no App Store Connect) e `appleTeamId`.

## App Store Connect — checklist de review

- **Privacy / Nutrition Labels:** o app coleta CPF (login) e mostra a posição do
  veículo (não a do usuário). Declarar: "Identificadores → conta" e "Localização"
  referente ao *ativo rastreado*, ligada à conta. Não há rastreamento de terceiros.
- **Encryption:** `ITSAppUsesNonExemptEncryption=false` já no `app.json` (só HTTPS).
- **Demo account:** fornecer um CPF + senha de teste pro revisor da Apple
  (criar um associado de demonstração e definir a senha com o script do backend).
- **Screenshots:** login, mapa com o veículo, histórico, alertas (6.7" e 6.5").

## Dependência: backend em produção

Os endpoints `/app/*` e a coluna `Associate.password` precisam estar **deployados
em `api.trackgo.site`** pro login funcionar. Rodar a migração `associate_app_auth`
em produção e o deploy do backend antes de publicar o app.

Definir a senha de um associado (operacional, no servidor):

```bash
cd backend
npx ts-node prisma/set-associate-password.ts <cpf> <senha>
```
