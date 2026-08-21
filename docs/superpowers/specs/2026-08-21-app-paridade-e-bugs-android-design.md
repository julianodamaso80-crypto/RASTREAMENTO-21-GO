# App 21 Tracker — paridade por público e bugs do Android (spec)

Data: 2026-08-21 · Aprovado em conversa (abordagem B, duas fases).

## Regra absoluta (do dono, 21/08/2026)

Função de **time interno** (instalar, IMEI, local de instalação, estoque, pendências, rota,
técnicos, chips, usuários, relatórios…) **nunca** aparece pro associado. Técnico é time interno
e entra **só por e-mail**, cadastrado como usuário interno. Não existe terceiro mundo no app.

Roteamento de login (inalterado): CPF/CNPJ → mundo do associado (`/app/*`); e-mail → mundo
interno (`/auth/login` + painel `trackgo.site` embarcado).

## Públicos e o que cada um tem

| Público | Como entra | O que vê | Fonte |
|---|---|---|---|
| Associado | CPF/CNPJ + senha | localização dos próprios veículos (mapa, histórico), alertas, perfil (nome, documento, e-mail, telefone, associação), troca/recuperação de senha | telas nativas + `/app/*` (já omite IMEI, instalação, técnico) |
| Time interno | e-mail + senha | 100% do painel web (22 rotas), dentro da WebView com sessão injetada | `interno/painel.tsx` |

## Estado encontrado (evidência)

- App Store serve **1.2.0** (16/07/2026); Play serve **1.3.0** (conta demo das lojas estava sem rastreador vinculado desde 13/08 — robô da Play bloqueado em 20/08; religado em 21/08) (não sei se `versionCode` 2 ou 3; o 3 tem o conserto do cofre do aparelho que derrubava o login inteiro).
- `mobile/app.json` **não tem `android.config.googleMaps.apiKey`**. `react-native-maps` no Android usa o Google Maps SDK e, sem chave, o processo cai ao montar `MapView`. Sessão salva + boot direto no mapa = "abre e fecha sozinho". iOS usa Apple Maps (sem chave) e por isso não sofre.
- Backend recusa login do associado com **duas** mensagens 401 distintas ("CPF ou senha inválidos" e "Nenhum rastreador instalado vinculado ao seu CPF…"); o app colapsa ambas em "CPF/e-mail ou senha inválidos". Quem tem CPF certo e senha certa mas está sem rastreador vinculado acha que errou a senha.
- `profile.tsx` formata o documento com `maskCpf`, que corta em 11 dígitos: associado PJ vê CNPJ errado.
- Botão Voltar físico do Android na WebView fecha o app em vez de voltar uma página do painel.
- Painel web já tem drawer mobile; 9 das 16 páginas do dashboard não têm `overflow-x-auto` em tabelas.

## Fase 1 — bugs + publicação (entrega separada)

1. Evidência: `versionCode` ao vivo na Play, contagem de "Login bloqueado (sem rastreador instalado)" no log do backend, `last_login_at` dos últimos 7 dias.
2. Chave do Google Maps para Android via `app.config.js` lendo `GOOGLE_MAPS_ANDROID_KEY` (secret do GitHub Actions); chave restrita a `com.r21go.client` + SHA-1.
3. Login mostra a mensagem do servidor quando o 401 é "sem rastreador instalado" (não é enumeração: só chega ali quem já acertou a senha).
4. Perfil usa `maskDocumento`.
5. Build `preview` (.apk) → teste no aparelho com `adb logcat` → build `production` Android + iOS → publicar → confirmar versões por `curl`.

Critério de aceite: associado com CPF + senha=CPF e rastreador instalado entra no Android; app com sessão salva abre no mapa e fica aberto; App Store e Play servem a mesma versão.

## Fase 2 — WebView interna acabada + associado

1. Voltar físico do Android navega na WebView (`canGoBack`) e só sai do app quando não há histórico.
2. Auditoria das rotas do painel a 390px (puppeteer-core) — nenhuma página com rolagem horizontal; tabelas em `overflow-x-auto`.
   **Resultado (21/08):** as 19 rotas públicas do menu já passam (`390/390`), medição validada injetando um div de 1200px; nenhuma alteração de frontend foi necessária.
3. Teste de contrato no backend que garante que `/app/vehicles`, `/app/alerts`, `/app/auth/login` e `/app/me` **nunca** devolvem `imei`, `installLocation`, `technician*`, `serial*`, `stock*` — a regra absoluta vira teste que falha. `/app/vehicles/:id/history` devolve só `toPositionDto` (posição do Traccar), sem registro do Prisma. Todas as respostas são allowlists explícitas (`toVehicleDto`, `toAlertDto`, `toAssociateDto`, `toMeDto`), nunca `...spread`.

Critério de aceite: funcionário navega por estoque → pendências → rota → Waze e volta com o botão físico sem sair do app; teste de contrato verde.

## Fora de escopo (registrado)

Telas nativas de campo, push, geofence do associado, replay nativo — não pedidos.
