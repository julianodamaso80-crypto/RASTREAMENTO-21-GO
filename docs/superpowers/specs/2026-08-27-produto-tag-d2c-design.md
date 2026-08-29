# MonitoraBem — Design do produto

> Marca nova, domínio novo, app novo, painel novo. Nasce em repositório próprio,
> importando quatro ou cinco núcleos já testados do 21 GO Rastreamento.

**Data:** 2026-08-27 (marca definida em 2026-08-29)
**Origem:** brainstorming a partir do módulo `ble-tags` e do worker Find My do 21 GO.

## Marca

**Nome:** MonitoraBem. O nome carrega dois sentidos ao mesmo tempo: monitora
bem-feito, e monitora **o seu bem** — o carro, a bike, o cachorro.

**Domínio:** `monitorabem.site`, registrado em 29/08/2026 (expira 29/08/2027),
DNS na Cloudflare (conta PROJETOS), renovação automática ligada.

**Pendente:** `monitorabem.com.br` e `monitorabem.app` seguem livres e devem ser
registrados como defesa de marca. Registro da marca no INPI nas classes 9
(aparelhos e software), 38 (telecomunicação), 42 (serviços de tecnologia) e 45
(segurança e localização de bens).

---

## 1. O que é o produto

Um **serviço de localização por assinatura**, vendido direto ao consumidor final.
A pastilha (TAG) é o que dá acesso ao serviço; não é o produto em si.

**Preço:** R$ 99,00 de adesão + R$ 29,90/mês.

**Para que serve:** pet, bicicleta elétrica, mochila, mala, moto, carro, chave —
qualquer coisa que o dono queira encontrar depois. O tipo do item muda apenas
ícone e vocabulário na tela; a mecânica é idêntica para todos.

**Hardware:** TAG Bluetooth compatível com a rede Find My da Apple (TrackerKing
K-Tag e equivalentes), com chave privada nossa. Sem GPS, sem chip de celular,
bateria de aproximadamente um ano.

### 1.1 Por que a assinatura se justifica

A pastilha sozinha entrega pouco. A assinatura entrega o que ela não faz:

| A TAG sozinha | A assinatura |
|---|---|
| A Apple guarda 7 dias e apaga | Histórico guardado indefinidamente |
| Pontos soltos no mapa | Narrativa: locais habituais, onde passa a noite, onde parou por último |
| Não avisa nada | Notificação quando sai da área marcada |
| Só o dono vê | Compartilhamento com a família |
| Espera passar um iPhone | Botão "sumiu": ritmo acelerado + puxa os 7 dias inteiros |
| — | Suporte humano por WhatsApp |

---

## 2. Como a tecnologia funciona (e o que ela não faz)

A TAG não sabe onde está. Ela emite um anúncio Bluetooth continuamente. Os
iPhones de terceiros que passam perto captam esse anúncio, cifram a própria
localização com a chave pública da TAG e enviam à Apple. A Apple guarda o
envelope cifrado por 7 dias sem conseguir abri-lo. Nosso motor busca os
envelopes e os abre com a chave privada da TAG.

**Números medidos em campo (7 dias, uma TAG, RJ zona oeste):**

| Métrica | Valor |
|---|---|
| Pontos por dia | 107 a 520 |
| Intervalo entre pontos | 47 s (mediana) |
| Atraso entre o avistamento e a chegada do dado | **8 a 47 min** (mediana por dia) |
| Atraso no percentil 90 | 18 min a 3h17 |
| Maior intervalo sem posição | 59 min a **11 h** |

Fonte: `Aprendizados/tag-findmy-latencia-medida-em-producao.md` no vault.

**Consequência dura:** o produto entrega *"onde esteve"*, nunca *"onde está agora"*.

### 2.1 Caminhos avaliados e descartados

| Caminho | Por que não |
|---|---|
| **Find My oficial (MFi)** | O fabricante não recebe localização nenhuma — é ponta a ponta cifrada e só o dono vê, dentro do app Find My da Apple. Acessórios oficiais não podem ter app próprio nem estar em outra rede. Elimina qualquer produto de software |
| **Google Find Hub certificado** | Mesma restrição de privacidade. A especificação exige que apenas uma rede opere no dispositivo por vez — não existe TAG certificada nas duas. Exige certificação em laboratório terceirizado credenciado |
| **Rede colaborativa própria (modelo Tile)** | Base instalada inicial é zero. Em iOS, o scan em segundo plano só devolve resultado com filtro por service UUID declarado no Info.plist, e a TAG Find My não anuncia service UUID |
| **Linha GPS/4G** | Decisão do dono em 27/08/2026: o produto novo é TAG. Registrado aqui apenas para não ser rediscutido |

O caminho adotado é o **Find My não oficial**, com chaves próprias e consulta via
`macless-haystack`. É o mesmo caminho que a concorrente WGPS já opera
comercialmente no Brasil.

---

## 3. Arquitetura

```
   TAG (pastilha, Bluetooth)
        |
        v
   iPhones de terceiros que passam perto
        |  (cifram a localização e enviam)
        v
   Apple — guarda 7 dias, não consegue abrir
        |
        v
   MOTOR (Python)
   . consulta o backend: quais TAGs consultar agora
   . busca na Apple em lotes de 256 chaves, via proxy residencial
   . decifra com a chave privada de cada TAG
   . entrega os avistamentos ao backend
        |
        v
   BACKEND (NestJS + Prisma + PostgreSQL)
   . persiste avistamentos indefinidamente
   . monta trilha e narrativa
   . avalia cercas e dispara notificação
   . cobra a assinatura e aplica a régua de corte
        |
        +--> APP do dono (Expo / React Native, iOS + Android)
        +--> SITE e loja (Next.js)
        +--> PAINEL interno (Next.js)
```

**Stack:** a mesma que o 21 GO usa hoje, porque o código a ser importado já é
dela e o dono já a opera em produção — NestJS 11 + Prisma + PostgreSQL 17 no
backend, Next.js no painel e no site, Expo (SDK 54, `newArchEnabled: false`) no
app, Python 3.11 no motor.

**Repositório novo.** Não é fork. O que vem do 21 GO vem por cópia, arquivo a
arquivo, listado na seção 9.

---

## 4. Modelo de dados

O modelo do 21 GO não serve: lá a TAG é um `Device` preso a um `Vehicle` com
placa, e cachorro não tem placa.

```
Dono --< Protegido --1:1-- Tag --< Avistamento
  |
  +--< Assinatura
  +--< Compartilhamento (dono convida outra pessoa a ver um Protegido)
  +--< Cerca (por Protegido)
```

**Dono** — e-mail, senha, telefone, data de criação.

**Protegido** — nome ("Thor"), tipo (`CACHORRO | GATO | BIKE | MOCHILA | MALA |
CARRO | MOTO | OUTRO`), foto, observação. O tipo governa apenas ícone e
vocabulário de tela.

**Tag** — número de série impresso na caixa, `privateKey` e `hashedAdvKey`,
estado (`EM_ESTOQUE | ATIVADA | DEVOLVIDA`), lote de origem. A `privateKey`
nunca aparece em resposta de API; apenas o motor a lê, direto do banco.

**Avistamento** — latitude, longitude, raio de precisão em metros, `vistoEm`
(quando a TAG foi vista) e `recebidoEm` (quando soubemos). A diferença entre os
dois é o que o app mostra como idade do dado. Chave de deduplicação:
`(tagId, hashedAdvKey, vistoEm)`.

**Assinatura** — estado (`ATIVA | EM_ATRASO | SUSPENSA | CANCELADA`), próximo
vencimento, identificador da cobrança no gateway.

**Cerca** — centro, raio, e se está ligada.

**Compartilhamento** — quem mais pode ver aquele Protegido.

---

## 5. O motor

### 5.1 O que já está resolvido e é copiado

- **Decifragem** — ECDH sobre SECP224R1 + AES-GCM, portado de `biemster/FindMy`.
  Teste faz o percurso completo: monta um relatório como um iPhone montaria e
  confere que a coordenada exata volta.
- **Fila em disco** — se o backend cair, os relatórios já baixados não se perdem.
  Importa: a Apple descarta o que tem mais de 7 dias.
- **Proxy residencial obrigatório** — a Apple devolve **lista vazia sem erro**
  quando a consulta parte de um IP de datacenter, o que é indistinguível de
  "ninguém viu a TAG". O código se recusa a subir sem proxy configurado.
- **Piso de 30 minutos** — consultar mais rápido bane a conta Apple e não traz
  posição mais nova, já que o atraso da rede é maior que isso.

### 5.2 O que é novo

- **Lotes de 256 chaves.** Uma consulta à Apple aceita 256 chaves. Como cada TAG
  tem uma chave, uma conta cobre milhares de TAGs. O motor precisa fatiar a base
  em lotes e distribuí-los entre as contas disponíveis.
- **Pool de contas Apple.** Cada conta cobre um pedaço da base. Uma conta banida
  não pode derrubar todos os clientes. O painel interno mostra a saúde de cada
  conta: última consulta com sucesso, quantidade de TAGs sob ela, erros recentes.
- **Ritmo governado pela assinatura, não por alerta.** No 21 GO o gatilho é
  "rastreador neutralizado", que aqui não existe. A regra nova:

| Situação da TAG | Ritmo |
|---|---|
| Assinatura ativa | Ciclo normal (30 min) |
| Dono apertou "sumiu" | Ritmo acelerado por 24 h + backfill dos 7 dias |
| Assinatura suspensa há mais de 30 dias | Sai do ciclo |

- **Sessão persistida.** O `macless-haystack` registra um dispositivo novo a cada
  login, e a Apple limita quantos dispositivos ficam registrados na conta. Logar
  uma vez e guardar a sessão é obrigatório, não otimização.

---

## 6. O app do dono

Expo / React Native, iOS e Android, publicado na conta de empresa que já existe
(21GO, D-U-N-S 825995873) com bundle e nome novos. Não é preciso abrir conta de
desenvolvedor nova.

**Telas, por ordem de importância:**

1. **Meus protegidos** — lista. Cada cartão traz nome, foto e a frase que
   importa: *"Visto na Rua Aroazes, há 12 minutos"*. A idade do dado é sempre
   visível.
2. **Mapa do protegido** — trilha **tracejada**, um segmento por trecho contínuo,
   quebrada em intervalos maiores que 30 min. Círculo de precisão desenhado em
   metros reais (polígono, não raio em pixels). Popup com os dois carimbos de
   tempo. Botão "traçar rota até aqui" abrindo o Google Maps.
3. **História** — narrativa: locais habituais, pernoite, última parada.
4. **Sumiu** — botão destacado. Liga o ritmo acelerado, puxa os 7 dias inteiros e
   abre conversa com o suporte no WhatsApp.
5. **Cerca** — área em volta de casa, com notificação ao sair. A tela declara que
   o aviso chega com o mesmo atraso da rede.
6. **Compartilhar** — convidar outra pessoa a acompanhar um protegido.
7. **Assinatura** — estado, vencimento, forma de pagamento.

### 6.1 Ativação

Acontece na casa do cliente, sozinho. É o ponto mais frágil da jornada.

A caixa traz **QR code** (e o número embaixo, para quando o QR estiver riscado).
Fluxo: baixa o app → cria conta → aponta a câmera → dá um nome → escolhe o tipo →
pronto. Nenhuma etapa expõe IMEI, MAC, chave ou número de série técnico.

### 6.2 A regra de linguagem, verificada por teste

O app **nunca** escreve "tempo real", "motor desligado" ou "km percorridos". Um
teste varre os componentes e **falha o build** se qualquer um desses termos
aparecer. Esse teste é copiado do 21 GO e é requisito de release, não sugestão.

Vocabulário correto: *"Visto em X há N minutos"*, *"Parado em X desde …"*,
*"Sem novos avistamentos desde então — a TAG só aparece quando alguém passa
perto"*.

---

## 7. Cobrança

**Gateway:** Asaas. Recorrência nativa em Pix, cartão e boleto, webhook simples,
e taxa de Pix baixa — o que importa numa assinatura de R$ 29,90.

**Régua de inadimplência:**

| Situação | Efeito |
|---|---|
| Em dia | Tudo funciona |
| Vencida há até 5 dias | Funciona igual, com aviso no topo do app |
| 6 a 30 dias | Só a última posição conhecida. Sem histórico, sem cerca, sem notificação. A TAG continua sendo consultada |
| Mais de 30 dias | A TAG sai do ciclo de consulta. App mostra "assinatura vencida" |
| Voltou a pagar | Tudo volta imediatamente, **com o histórico intacto** |

Histórico de cliente inadimplente **nunca** é apagado. Custa pouco guardar e é o
que traz o cliente de volta.

---

## 8. Painel interno e site

**Painel interno** (acesso restrito à equipe):

- Importar o `.xlsx` de chaves que o fabricante entrega por lote (colunas SN,
  MAC, `privateKey`, `hashedAdvKey`), gerando as TAGs em estoque.
- Clientes, protegidos, assinaturas, histórico de cobrança.
- **Saúde do pool de contas Apple**: última consulta com sucesso por conta,
  quantidade de TAGs sob cada uma, erros recentes, estado do proxy.
- Visão de suporte: ver o que o cliente está vendo, para atender por telefone.

**Site** (Next.js): página de produto, checkout com Pix e cartão, e ativação pelo
navegador para quem não quer instalar o app antes de comprar.

Recomendação comercial: publicar também no Mercado Livre desde o primeiro dia —
não pela margem, mas porque lá existe tráfego já procurando o produto, e isso
mede a demanda real em semanas em vez de meses.

---

## 9. O que é copiado do 21 GO

| Origem | Destino | Observação |
|---|---|---|
| `worker-findmy/findmy_crypto.py` + testes | Motor | Cópia literal. Alterar qualquer byte quebra a decifragem silenciosamente |
| `ktag-findmy-worker/findmy_worker/outbox.py`, `dedupe.py`, `backfill.py` | Motor | Fila em disco e deduplicação |
| `ktag-findmy-worker/findmy_worker/apple_client.py` | Motor | Proxy residencial e sessão persistida |
| `backend/src/modules/ble-tags/tag-insights.ts` + testes | Backend | Função pura: entra lista de pontos, sai conclusão |
| `backend/src/modules/ble-tags/polling-mode.ts` | Backend | Conceito e piso de 30 min; o gatilho muda (assinatura, não alerta) |
| `frontend/dashboard/src/components/ble-tags/tag-historico-frases.ts` | App | Vocabulário honesto |
| `scripts/diagnostics/tag-historico-honesto.js` | App | O teste que proíbe a tela de mentir |
| `frontend/dashboard/src/components/ble-tags/tag-trail-map.tsx` | App | Lógica da trilha; o visual é refeito na marca nova |
| `mobile/src/lib/` (auth-store, biometrics, api) | App | Base de autenticação e cliente HTTP |

**O que não é copiado:** `ble-tags.service.ts` (cerca de 70% é cruzamento com SGA
Hinova, espelho da RedeVeiculos, placa e Traccar), `rdv-tag-import.ts`,
`tag-ativa-regra.ts`, e o modelo de TAG como `Device` preso a `Vehicle`.

---

## 10. Riscos

| Risco | Gravidade | Tratamento |
|---|---|---|
| Apple fechar a porta para TAGs não certificadas | Alta — encerra o produto | Não há defesa técnica. A defesa é comercial: não depender de um único produto no longo prazo |
| Conta Apple banida | Média | Pool de contas, cada uma cobrindo um pedaço da base; piso de 30 min no código; sessão persistida |
| Proxy residencial fora do ar | Média | O motor se recusa a consultar sem proxy. Precisa de alarme: silêncio prolongado é indistinguível de "ninguém viu" |
| Cliente comprar achando que é GPS | Alta — principal causa de cancelamento | Linguagem honesta na venda, no app, e o teste que quebra o build |
| iPhone de terceiro alertar "rastreador desconhecido viajando com você" | Média | É o padrão anti-perseguição obrigatório das duas plataformas (DULT) e não pode ser desligado. Precisa estar explicado no site |
| Anatel barrar a importação | Alta se importar direto | Resolução 715 torna a homologação obrigatória e a Receita a exige no desembaraço. Comprar de importador com o modelo já homologado, ou orçar R$ 14–50 mil e 2–3 meses |
| Fluxo de caixa | Média | R$ 99 de adesão não cobre aparelho + logística. Cada venda consome caixa e se paga ao longo dos primeiros meses de assinatura |

---

## 11. Ordem de construção

Cada bloco vira seu próprio plano de implementação. Este documento **não** vira um
plano só.

| # | Bloco | Entrega | Depende de |
|---|---|---|---|
| 1 | **Motor** | Worker com pool de contas, lotes de 256, fila em disco, proxy | — |
| 2 | **Backend** | Dono, protegido, TAG, avistamento, trilha, história, cerca | 1 |
| 3 | **App** | As 7 telas e a ativação por QR ponta a ponta | 2 |
| 4 | **Cobrança** | Assinatura Asaas, webhook, régua de corte | 2 |
| 5 | **Painel interno** | Importação de lotes, clientes, saúde do pool | 2 |
| 6 | **Site e loja** | Venda, checkout, ativação pelo navegador | 4 |
| 7 | **Publicação** | Lojas, marca, embalagem, QR | 3, 6 |

O bloco 2 pode começar antes de o bloco 1 terminar, usando dados semeados — foi
assim que a trilha e a narrativa foram construídas e testadas no 21 GO antes de
existir worker.

### 11.1 Critérios de aceitação por bloco

1. **Motor** — uma TAG real, com chave real, tem sua posição decifrada e entregue
   ao backend. Backend derrubado no meio do ciclo não perde nenhum avistamento.
2. **Backend** — uma TAG com 7 dias de avistamentos produz trilha segmentada e
   narrativa coerente; cerca dispara ao sair da área.
3. **App** — uma pessoa que nunca viu o produto ativa a TAG sozinha, sem ajuda, e
   vê a posição. O teste de linguagem passa.
4. **Cobrança** — assinatura criada, paga por Pix, webhook libera a conta sem
   intervenção. Vencida há 31 dias, a TAG sai do ciclo; ao pagar, volta com o
   histórico intacto.
5. **Painel** — o `.xlsx` de um lote do fabricante vira estoque de TAGs. A saúde
   de cada conta Apple é visível.
6. **Site** — uma compra do zero, com Pix, gera conta e libera ativação.
7. **Publicação** — app aprovado nas duas lojas.

---

## 12. Decisões em aberto

Não bloqueiam o início do bloco 1, mas precisam ser fechadas antes do bloco 7:

- **Fornecedor da TAG.** Importar direto (com homologação Anatel própria) ou
  comprar de importador que já tenha o modelo homologado.
- **Fornecedor de proxy residencial** e custo mensal por volume de consulta.
