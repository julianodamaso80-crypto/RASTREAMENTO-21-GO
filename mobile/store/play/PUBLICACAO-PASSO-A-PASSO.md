# Publicação no Google Play — passo a passo (21 Tracker Rastreamento)

Conta: **organização 21 Tracker Rastreamento** · ID `5791248229168391315` · pacote `com.r21go.client`.
Todos os textos e valores abaixo já estão prontos — é copiar, colar e clicar.
Ordem importa: siga de cima pra baixo.

---

## 0. Antes de começar — tenha em mãos
- [ ] **`.aab` v1.2.0**: baixe em `expo.dev` -> projeto **r21go-cliente** -> **Builds** -> versão 1.2.0 -> Download.
- [ ] **2 a 4 capturas de tela** do app (login, mapa com veículo, histórico, alertas). Print de celular serve; formato retrato (9:16), lado menor >= 320 px.
- [ ] Verificação de identidade da conta **enviada** (feito) — a publicação final só libera quando o Google aprovar (chega por e-mail).

---

## 1. Registrar o nome do pacote  (tela onde você está)
Menu -> **Verificação de desenvolvedor Android** -> aba **Nomes de pacote** -> **Registrar nome do pacote**.
- Nome do pacote: `com.r21go.client`
- Confirmar.

> Por quê: a partir de set/2026 o Google exige que cada app seja registrado por um desenvolvedor verificado. Registrar agora evita bloqueio depois.

---

## 2. Criar o app
Página inicial -> **Criar app**.
- **Nome do app:** `21 Tracker Rastreamento`
- **Idioma padrão:** Português (Brasil)
- **App ou jogo:** App
- **Gratuito ou pago:** Gratuito
- Aceitar as declarações (diretrizes + leis de exportação dos EUA) -> **Criar app**.

---

## 3. Ficha principal da loja
App -> **Crescimento -> Presença na loja -> Ficha principal da loja**. Textos completos em `TEXTOS-PLAY.md`:
- **Nome:** `21 Tracker Rastreamento`
- **Descrição breve** (80): copiar do TEXTOS-PLAY.md
- **Descrição completa** (4000): copiar do TEXTOS-PLAY.md
- **Ícone:** subir `icon-512.png`
- **Gráfico de destaque:** subir `feature-graphic-1024x500.png`
- **Capturas de tela (telefone):** subir os 2-4 prints que você tirou
- Salvar.

---

## 4. Configurar o app (seção "Configuração")
Preencher, na ordem que o Console pedir:

**Acesso ao app** -> "Todas ou algumas funcionalidades são restritas" -> adicionar credencial de teste:
- CPF e senha da conta demo: **1Password**, item "conta demo de revisao das lojas" (nao vao pro repositorio — regra 7 do CLAUDE.md)
- Instrução: informar CPF e senha na tela de login; o veículo TST1J16 aparece no mapa.

**Anúncios** -> **Não**, o app não contém anúncios.

**Classificação de conteúdo** -> iniciar questionário IARC:
- E-mail: o da conta · Categoria: **Utilitário/Produtividade/Comunicação**
- Responder "Não" a todo conteúdo sensível (violência, sexo, drogas, etc.) -> deve sair **Livre/L**.

**Público-alvo e conteúdo** -> faixa **18+** · o app **não** é direcionado a crianças.

**Segurança dos dados** -> respostas prontas no `TEXTOS-PLAY.md` (seção "Segurança de dados"):
- Coleta dados? **Sim** (CPF, para login) · Compartilha? **Não**
- Criptografado em trânsito? **Sim** · Exclusão? **Sim, via associação**
- Localização? **NÃO** (o app mostra a posição do veículo, nunca a do celular)

**Categoria do app** -> **Mapas e navegação**. Contato: e-mail da conta · Site: `https://trackgo.site`.

**Política de privacidade** -> `https://api.trackgo.site/privacidade`.

---

## 5. Subir o app em teste interno
App -> **Testar e lançar -> Testes -> Teste interno** -> **Criar versão**.
- Se pedir, aceitar o **Play App Signing** (recomendado).
- **Upload do `.aab`** que você baixou do EAS (v1.2.0).
- Notas da versão: `Primeira versão do app do associado.`
- Revisar -> **Salvar e publicar** no teste interno.
- Em **Testadores**, adicionar o seu e-mail (e de quem for testar), copiar o **link de acesso** e abrir no celular pra instalar.

> Teste interno libera na hora (não espera revisão) e é onde você confirma que o app funciona antes de mandar pra produção.

---

## 6. Produção (só depois da verificação aprovada)
Quando o Google aprovar a verificação de identidade (e-mail):
App -> **Testar e lançar -> Produção** -> **Criar versão** -> reusar o `.aab` do teste interno -> preencher o formulário de lançamento -> enviar para revisão.
- A primeira revisão de produção costuma levar de alguns dias a ~1 semana.

---

## Onde travar -> me chame
Se qualquer tela pedir algo que não está aqui, tira print e manda. Os pontos que costumam confundir: Play App Signing (aceite), formulário de segurança de dados (respostas acima) e o link de teste interno.
