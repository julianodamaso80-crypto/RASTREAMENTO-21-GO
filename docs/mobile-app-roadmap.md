# Roadmap Mobile - Rastreamento 21 GO

> Plano de implementacao em sprints para os apps mobile Admin e Cliente.

---

## Visao Geral da Timeline

```
┌────────────────────────────────────────────────────────────────────────┐
│                    TIMELINE TOTAL: ~16 SEMANAS                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  FASE 0: Setup          ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░  (2 sem)     │
│  FASE 1: App Cliente    ░░██████████████████░░░░░░░░░░░░  (8 sem)     │
│  FASE 2: App Admin      ░░░░░░░░░░░░░░░░░░░░████████████  (6 sem)    │
│                                                                        │
│  Semana:  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## FASE 0: Fundacao (Semanas 1-2)

### Sprint 0.1 — Setup Monorepo + Shared Packages (Semana 1)

**Objetivo:** Reestruturar o monorepo e criar packages compartilhados.

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | Instalar e configurar Turborepo | 4h | turbo.json funcional |
| 2 | Mover `backend/` para `apps/backend/` | 2h | Paths atualizados, tudo rodando |
| 3 | Mover `frontend/dashboard/` para `apps/dashboard/` | 2h | Paths atualizados, tudo rodando |
| 4 | Criar `packages/shared-types/` com interfaces existentes | 6h | Types exportados, usados no dashboard |
| 5 | Criar `packages/api-client/` extraindo da lib/api.ts | 6h | API client compartilhado |
| 6 | Criar `packages/validation/` com Zod schemas | 4h | Schemas exportados |
| 7 | Criar `packages/utils/` com funcoes geo/format | 4h | Utils exportados |
| 8 | Configurar Turborepo pipelines (build, dev, lint) | 4h | `turbo run dev` funciona |
| 9 | Testar que dashboard e backend continuam funcionando | 4h | CI verde |

**Total Sprint:** ~36h  
**Risco:** Quebrar imports existentes. Mitigacao: fazer commit por commit, testar a cada mudanca.

### Sprint 0.2 — Setup Expo + Configuracao Base (Semana 2)

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | `npx create-expo-app apps/mobile --template blank-typescript` | 1h | App Expo rodando |
| 2 | Configurar metro.config.js para monorepo | 3h | Metro resolve packages/ |
| 3 | Configurar expo-router v4 | 3h | Navegacao file-based |
| 4 | Configurar NativeWind v4 (Tailwind) | 3h | Estilos Tailwind funcionando |
| 5 | Configurar EAS Build (eas.json) | 2h | `eas build` funciona |
| 6 | Configurar flavors Admin vs Client (app.config.ts) | 4h | 2 bundle IDs distintos |
| 7 | Setup Zustand stores (auth, tracking, vehicle, alert) | 4h | Stores vazios mas tipados |
| 8 | Integrar shared-types, api-client, utils no mobile | 4h | Imports funcionam |
| 9 | Setup MMKV + expo-secure-store | 2h | Storage configurado |
| 10 | Gerar primeiro dev build (EAS ou local) | 2h | APK/IPA de teste |

**Total Sprint:** ~28h  
**Risco:** Metro bundler com monorepo. Mitigacao: seguir guia oficial Expo Monorepo.

---

## FASE 1: App Cliente MVP (Semanas 3-10)

### Sprint 1.1 — Autenticacao (Semana 3)

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | Tela de Login (email + senha) | 4h | UI com NativeWind |
| 2 | Integrar api-client login() | 3h | Login funciona contra backend |
| 3 | Armazenamento seguro (SecureStore) | 2h | Tokens persistidos |
| 4 | Interceptor Axios (auto-refresh JWT) | 4h | 401 → refresh automatico |
| 5 | Auto-login flow (verificar token ao abrir) | 3h | Splash → Dashboard direto |
| 6 | Tela de logout + limpar tokens | 1h | Logout completo |
| 7 | Tela "Esqueci minha senha" (placeholder) | 2h | UI basica |

**Total Sprint:** ~19h  
**Criterio de aceite:** Login → salva token → reabrir app → auto-login → logout.

### Sprint 1.2 — Mapa em Tempo Real (Semanas 4-5)

**Sprint mais critico — core da experiencia.**

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | Instalar e configurar @maplibre/maplibre-react-native | 4h | Mapa renderiza |
| 2 | Configurar tile source (MapTiler ou OpenFreeMap) | 2h | Tiles carregam |
| 3 | Singleton Socket.io service (conectar ao wss://api.trackgo.site) | 4h | Socket conecta com JWT |
| 4 | Handler `position:update` → atualizar posicoes no store | 4h | Posicoes chegam |
| 5 | Renderizar markers de veiculos (ShapeSource + SymbolLayer) | 6h | Markers no mapa |
| 6 | Icones customizados com rotacao (direcao do veiculo) | 4h | Setas indicam direcao |
| 7 | Clustering nativo para densidade alta | 4h | Clusters com contagem |
| 8 | Centralizar mapa ao selecionar veiculo | 2h | Tap no marker → zoom |
| 9 | Animacao suave de movimento de markers | 6h | Transicao fluida |
| 10 | Filtrar veiculos por tenant do usuario logado | 2h | Multi-tenant respeitado |
| 11 | Status visual: online (verde), parado (amarelo), offline (cinza) | 3h | Cores nos markers |
| 12 | Reconexao automatica Socket.io (AppState + NetInfo) | 4h | Reconecta ao voltar |

**Total Sprint:** ~45h (2 semanas)  
**Criterio de aceite:** Mapa com veiculos movendo em tempo real, cores de status, clustering.

### Sprint 1.3 — Lista e Detalhes de Veiculos (Semana 6)

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | Tela de lista de veiculos (FlatList otimizada) | 4h | Lista com scroll rapido |
| 2 | Card de veiculo (placa, modelo, status, velocidade, endereco) | 3h | Cards informativos |
| 3 | Barra de filtros (Todos, Movimento, Parado, Offline, Alerta) | 3h | Tabs de filtro |
| 4 | Busca por placa ou modelo | 2h | SearchBar funcional |
| 5 | Tela de detalhe do veiculo | 4h | Info completa |
| 6 | Velocidade, ignicao, ultima posicao, endereco | 3h | Dados em tempo real |
| 7 | Navegacao: tap veiculo na lista → detalhe | 1h | Deep link |
| 8 | Navegacao: tap veiculo na lista → centralizar no mapa | 2h | Integracao mapa-lista |

**Total Sprint:** ~22h  
**Criterio de aceite:** Lista filtravel, busca, detalhes do veiculo com dados real-time.

### Sprint 1.4 — Historico de Rotas (Semana 7)

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | Tela de historico de rotas (date picker: de/ate) | 4h | UI com seletor de datas |
| 2 | Integrar API de posicoes historicas | 3h | Dados do Traccar |
| 3 | Renderizar rota como Polyline (LineLayer) | 4h | Rota no mapa |
| 4 | Pontos de parada (marcadores vermelhos) | 2h | Paradas visiveis |
| 5 | Info da viagem: distancia, duracao, velocidade media/maxima | 3h | Resumo da viagem |
| 6 | Animacao de replay da rota (slider temporal) | 6h | Reproduzir percurso |
| 7 | Lista de viagens do dia | 2h | Viagens separadas |

**Total Sprint:** ~24h  
**Criterio de aceite:** Selecionar data → ver rota no mapa com replay e detalhes.

### Sprint 1.5 — Alertas e Push Notifications (Semana 8)

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | Configurar @react-native-firebase/messaging | 4h | FCM funcional |
| 2 | Backend: NotificationsService com firebase-admin | 4h | Backend envia push |
| 3 | Backend: salvar device token no login mobile | 2h | Token registrado |
| 4 | Backend: enviar push quando alerta e criado | 4h | Push chegam no app |
| 5 | Handler de push em foreground (toast notification) | 3h | Toast no app |
| 6 | Handler de push em background (system notification) | 3h | Notificacao do sistema |
| 7 | Deep link: tap na notificacao → abrir veiculo | 3h | Navegacao direta |
| 8 | Tela de alertas (lista com filtros) | 4h | Lista de alertas |
| 9 | Marcar alerta como lido / marcar todos como lidos | 2h | Acoes de alerta |
| 10 | Badge de contagem no tab de alertas | 1h | Badge atualiza |
| 11 | Configuracoes de notificacao (quais alertas receber) | 3h | Preferencias por tipo |

**Total Sprint:** ~33h  
**Criterio de aceite:** Push notifications chegam, tela de alertas funcional, deep links.

### Sprint 1.6 — Features do Cliente + Polish (Semanas 9-10)

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | Botao de resgate / acionamento (envia alerta SOS ao backend) | 4h | SOS funcional |
| 2 | Modo panico (tela de emergencia com localizacao) | 4h | Modo panico ativo |
| 3 | Compartilhar localizacao com familiares (expo-contacts + deep link) | 6h | Link de compartilhamento |
| 4 | Tela de perfil do usuario | 3h | Dados do usuario |
| 5 | Biometria: configurar e usar (expo-local-authentication) | 4h | Face ID/Fingerprint |
| 6 | Placeholder: boletos e pagamentos (integracao futura Hinova) | 3h | Tela com aviso "em breve" |
| 7 | Offline mode basico (banner + dados em cache) | 4h | UX offline graceful |
| 8 | Testes em devices fisicos (Android + iOS) | 6h | Bugs corrigidos |
| 9 | Ajustes de UX, transicoes, loading states | 6h | UX polida |
| 10 | Preparar assets (icone, splash, screenshots) | 3h | Assets prontos |
| 11 | Preparar politica de privacidade | 2h | URL publica |
| 12 | Submeter App Cliente na Play Store + App Store | 6h | Apps submetidos |

**Total Sprint:** ~51h (2 semanas)  
**Criterio de aceite:** App Cliente completo e submetido nas stores.

---

## FASE 2: App Admin MVP (Semanas 11-16)

> O App Admin compartilha toda a base do App Cliente e adiciona features de gestao.

### Sprint 2.1 — Bloqueio Remoto + Gestao de Veiculos (Semanas 11-12)

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | Mapa com TODOS os veiculos (nao filtrado por usuario) | 3h | Visao completa da frota |
| 2 | Painel de dashboard (contadores: total, online, offline, alerta) | 4h | Dashboard resumido |
| 3 | Bloqueio remoto (botao + modal de confirmacao + API) | 6h | Bloquear/desbloquear |
| 4 | Feedback visual de bloqueio (status no card e mapa) | 2h | UX clara |
| 5 | Cadastro de veiculos (formulario completo) | 6h | CRUD veiculo |
| 6 | Editar/excluir veiculo | 4h | CRUD completo |
| 7 | Detalhes expandidos: associado, chip, rastreador | 4h | Info tecnica |
| 8 | Relatorios: viagens, paradas, posicoes (tabelas) | 6h | Telas de relatorio |
| 9 | Export de relatorios (compartilhar PDF/CSV) | 4h | Share sheet |

**Total Sprint:** ~39h (2 semanas)  
**Criterio de aceite:** Gestao completa de veiculos, bloqueio remoto, relatorios.

### Sprint 2.2 — QR Scanner + Comandos SMS (Semana 13)

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | QR Scanner com expo-camera (scan IMEI do rastreador) | 4h | Camera com scan |
| 2 | Fluxo: scan → preencher dados do rastreador automaticamente | 3h | Auto-fill IMEI |
| 3 | Cadastro de rastreador (vincular a veiculo) | 4h | Rastreador registrado |
| 4 | Geracao de comandos SMS para rastreadores | 6h | SMS formatados |
| 5 | Tela: selecionar modelo → gerar sequencia de comandos | 4h | Lista de comandos |
| 6 | Copiar comando / abrir app SMS com comando preenchido | 2h | Integracao SMS |
| 7 | Suporte multi-IP (primario + secundario para J16/GT06) | 3h | SERVER,1 + SERVER,2 |

**Total Sprint:** ~26h  
**Criterio de aceite:** Tecnico escaneia QR, registra rastreador, envia comandos SMS.

### Sprint 2.3 — BLE Diagnostico + Chips M2M (Semana 14)

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | Instalar react-native-ble-plx + config plugin | 3h | BLE funcional |
| 2 | Tela de scan BLE (descobrir rastreadores proximos) | 6h | Lista de devices BLE |
| 3 | Conectar ao rastreador via BLE | 4h | Conexao estabelecida |
| 4 | Ler dados de diagnostico (firmware, sinal, bateria) | 6h | Dados exibidos |
| 5 | Tela de gestao de chips M2M (lista, status) | 4h | Lista de chips |
| 6 | Info do chip: operadora, ICCID, consumo, status | 3h | Detalhes do chip |

**Total Sprint:** ~26h  
**Risco Alto:** BLE com rastreadores reais e imprevisivel. Prototipar cedo com device real.  
**Criterio de aceite:** Conectar via BLE ao rastreador, ler dados basicos.

### Sprint 2.4 — Geofences + Alertas Admin (Semana 15)

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | Lista de geofences do tenant | 3h | Lista com dados |
| 2 | Visualizar geofences no mapa (FillLayer poligonos, CircleLayer circulos) | 4h | Geofences no mapa |
| 3 | Criar geofence (desenhar no mapa) | 8h | CRUD geofence |
| 4 | Vincular veiculos a geofences | 3h | Vinculo funcional |
| 5 | Alertas operacionais: painel com todos os alertas do tenant | 3h | Visao operacional |
| 6 | Filtros avancados: por tipo, veiculo, periodo | 3h | Filtros funcionais |

**Total Sprint:** ~24h  
**Criterio de aceite:** CRUD de geofences com visualizacao no mapa, alertas filtrados.

### Sprint 2.5 — Polish Admin + Submissao (Semana 16)

| # | Tarefa | Horas | Entregavel |
|---|---|---|---|
| 1 | WatermelonDB sync completo para dados admin | 6h | Offline robusto |
| 2 | Testes em devices fisicos (Android + iOS) | 6h | Bugs corrigidos |
| 3 | Performance: testar com 100+ veiculos reais | 4h | Performance ok |
| 4 | Ajustes de UX admin-specific | 4h | UX polida |
| 5 | Preparar assets admin (icone, splash, screenshots) | 3h | Assets prontos |
| 6 | Video demonstrativo para Google Play (localizacao background) | 3h | Video gravado |
| 7 | Submeter App Admin na Play Store + App Store | 6h | Apps submetidos |
| 8 | Documentar processo de build/deploy | 3h | README atualizado |

**Total Sprint:** ~35h  
**Criterio de aceite:** App Admin completo e submetido nas stores.

---

## Resumo de Horas por Fase

| Fase | Sprints | Semanas | Horas |
|---|---|---|---|
| **Fase 0:** Fundacao | 0.1 + 0.2 | 2 | ~64h |
| **Fase 1:** App Cliente | 1.1 a 1.6 | 8 | ~194h |
| **Fase 2:** App Admin | 2.1 a 2.5 | 6 | ~150h |
| **TOTAL** | 13 sprints | **16 semanas** | **~408h** |

---

## Marcos (Milestones)

| Marco | Semana | Entregavel |
|---|---|---|
| M0: Monorepo + Expo funcional | Semana 2 | Build de teste gerando |
| M1: Mapa com veiculos em tempo real | Semana 5 | Core funcionando |
| M2: App Cliente feature-complete | Semana 9 | Todas features do cliente |
| M3: App Cliente nas stores | Semana 10 | Submetido para revisao |
| M4: App Admin feature-complete | Semana 15 | Todas features do admin |
| M5: App Admin nas stores | Semana 16 | Submetido para revisao |

---

## Dependencias Externas

| Dependencia | Necessario em | Acao |
|---|---|---|
| Conta Apple Developer ($99) | Semana 2 (build iOS) | Criar conta organizacao com D-U-N-S |
| Conta Google Play ($25) | Semana 2 (build Android) | Criar conta desenvolvedor |
| Projeto Firebase | Semana 8 (push) | Criar projeto, baixar configs |
| Rastreador fisico para teste BLE | Semana 14 | Ter J16/GT06 disponivel |
| Politica de privacidade | Semana 10 | URL publica acessivel |
| Video demonstrativo (Google Play) | Semana 16 | Gravar video do app |

---

## Pos-MVP (Backlog Futuro)

### Evolucoes Planejadas

| Feature | Prioridade | Fase |
|---|---|---|
| Boletos e pagamentos (integracao Hinova real) | Alta | v1.1 |
| White-label para outros clientes | Media | v1.2 |
| Modo escuro | Baixa | v1.1 |
| Widget de tela inicial (posicao do veiculo) | Baixa | v1.2 |
| Apple Watch / Wear OS companion | Baixa | v2.0 |
| Integracao com Waze/Google Maps para navegacao | Media | v1.1 |
| Relatorios em PDF com graficos | Media | v1.2 |
| Chat entre admin e cliente | Baixa | v2.0 |
| Suporte a multiplos idiomas | Baixa | v2.0 |
| Performance com 1000+ veiculos | Alta | v1.1 |

### Evolucoes Tecnicas

| Feature | Prioridade | Fase |
|---|---|---|
| E2E tests (Detox ou Maestro) | Alta | v1.1 |
| CI/CD com GitHub Actions + EAS | Alta | v1.1 |
| Sentry/Crashlytics monitoramento | Alta | v1.0.1 |
| Analytics (Firebase Analytics) | Media | v1.0.1 |
| Code Push (EAS Update) para hotfixes | Alta | v1.1 |
| Certificate Pinning | Media | v1.1 |
| Testes de carga (100+ veiculos simultaneos) | Alta | v1.1 |

---

## Checklist Pre-Sprint 0

Antes de comecar a implementacao, garantir:

- [ ] Conta Apple Developer criada (pode levar dias para D-U-N-S)
- [ ] Conta Google Play criada
- [ ] Backend em https://api.trackgo.site estavel e com endpoints documentados
- [ ] WebSocket em wss://api.trackgo.site funcional
- [ ] Swagger atualizado em https://api.trackgo.site/api/docs
- [ ] Pelo menos 1 rastreador enviando dados reais para teste
- [ ] Design das telas principais (Figma ou wireframes basicos)
- [ ] Dominio da politica de privacidade definido
- [ ] Time alinhado sobre prioridades e timeline
