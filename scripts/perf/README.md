# Medição de experiência — `scripts/perf/`

Scripts que medem o painel **do jeito que o operador sente** (clique → tela pronta), no nosso painel e
na Rede Veículos (RDV), e provam o mapa do estoque (cluster e uso prolongado). Node ≥ 20,
`puppeteer-core` da raiz do repositório, Chrome instalado. Nenhuma dependência nova.

| Script | O que faz |
|---|---|
| `medir-experiencia.mjs` | Mede A/B/C/D por ação, em rodadas, no nosso painel e/ou na RDV. Gera JSON, CSV e `resumo.md`. |
| `comparar.mjs` | Junta "nosso antes", "nosso depois" e "RDV" na tabela do dono, com a coluna Situação. |
| `provar-cluster-estoque.mjs` | F4 — prova que o agrupamento do mapa do estoque não esconde ponto. PASS/FAIL por checagem + capturas. |
| `uso-prolongado-estoque.mjs` | F5 — 10 × "Mostrar mais", busca, seleção e 20 min parado; long tasks e memória a cada 60 s. PASS/FAIL. |
| `comum.mjs` | Peças compartilhadas (navegador, instrumentação, estatística, login do painel). |

## Antes de rodar

1. Crie `.env.perf` na raiz do repositório (o git ignora este arquivo):

   ```
   PERF_USER=admin@rastreamento21go.com.br   # seed na homologação; em produção, conta de teste
   PERF_PASS=...
   PERF_PLACA=ABC1D23                        # placa que existe nos dois sistemas
   PERF_IMEI=86...                           # IMEI que está no estoque (de preferência dentro de um grupo no mapa)
   # opcionais
   PERF_BASE=https://trackgo.site            # frontend do painel
   PERF_API=https://api.trackgo.site         # se a API não for api.<domínio> ou localhost:3001
   RDV_BASE=https://21go.rastreamento.vip
   CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe
   ```

   A senha da RDV **nunca** vai neste arquivo: na RDV quem digita é o dono, na janela que o script abre.
2. No Git Bash do Windows, prefixe com `MSYS_NO_PATHCONV=1` — senão o Git Bash troca argumentos que
   começam com `/` (rotas) por caminhos do Windows.
3. Resultados vão para `scripts/perf/resultados/` e capturas para `docs/clonagem/perf/` — as duas
   pastas ficam fora do git (podem ter placa, IMEI e endereço).

## `medir-experiencia.mjs`

```bash
# nosso painel publicado, 5 rodadas, cache aquecido
MSYS_NO_PATHCONV=1 node scripts/perf/medir-experiencia.mjs --alvo nosso --nivel 4 --rodadas 5 --modo quente

# comparação alternada nosso × RDV (o dono digita a senha da RDV na janela que abrir)
MSYS_NO_PATHCONV=1 node scripts/perf/medir-experiencia.mjs --alvo nosso,rdv --nivel 4 --rodadas 5 --modo quente
MSYS_NO_PATHCONV=1 node scripts/perf/medir-experiencia.mjs --alvo nosso,rdv --nivel 4 --rodadas 5 --modo frio

# frontend local contra API real (nível 2), só algumas ações
MSYS_NO_PATHCONV=1 node scripts/perf/medir-experiencia.mjs --alvo nosso --base http://localhost:3000 --nivel 2 \
  --acoes abrir-estoque-mapa,buscar-imei --flags "NEXT_PUBLIC_STOCK_MAP_CLUSTER=on"
```

| Opção | Padrão | |
|---|---|---|
| `--alvo` | `nosso` | `nosso`, `rdv` ou `nosso,rdv` (dois navegadores, sessões separadas, rodadas alternadas) |
| `--nivel` | — (obrigatório) | 1 sintético · 2 frontend local + API real · 3 homologação completa · 4 produção publicada |
| `--rodadas` | 5 | a regra pede ≥ 5 por função para comparar |
| `--modo` | `quente` | `frio` limpa o cache HTTP antes de cada ação (a sessão continua) |
| `--acoes` | todas | `login, abrir-painel, abrir-mapa, buscar-placa, abrir-detalhe, abrir-historico, abrir-estoque, buscar-imei, abrir-estoque-mapa` |
| `--base` / `--base-rdv` | trackgo.site / 21go.rastreamento.vip | |
| `--flags` | — | texto livre com as flags ativas na versão medida (vai para cada linha do CSV) |
| `--pausa` / `--pausa-rodada` | 3000 / 10000 ms | ritmo de gente entre ações e entre rodadas |
| `--visivel` | — | abre o nosso painel em janela (a RDV é sempre visível) |
| `--perfil-cpu` | — | grava um `.cpuprofile` por ação em `resultados/perfis/`; essas amostras **não entram** nas medianas |
| `--rdv-novo-login` | — | usa um perfil novo na RDV (sem isso o perfil `%TEMP%/perf-rdv-perfil` guarda o cookie da sessão — nunca a senha; o gerenciador de senhas do Chrome fica desligado nesse perfil) |

### O que cada métrica quer dizer

- **A — primeira resposta visual.** Do clique/tecla até o primeiro quadro desenhado depois da primeira
  mudança no DOM (o eco da tecla no campo não conta). Quando a ação troca de página, é a primeira
  pintura com conteúdo (FCP) do documento novo.
- **B — resultado utilizável.** Do clique até a tela servir para trabalhar: o elemento da ação existe,
  não há spinner/skeleton e há ao menos uma linha/marcador/card. Na RDV, B também espera terminar o
  último XHR disparado pela ação (rede quieta por 500 ms) — o DOM deles não está mapeado no código.
- **C — idade do dado.** O que a tela escreve ("Última atualização há 3 minutos", "14/10/2026, 10:23:45")
  comparado com o relógio. Frase relativa vira faixa (ex.: "há 3 minutos" = 150–210 s) e o JSON guarda a
  faixa; data absoluta é lida como horário de Brasília (`PERF_TZ_OFFSET_MIN`, padrão −180).
- **D — erros.** Erros de console, pedidos que falharam (status ≥ 400 ou erro de rede), long tasks
  (quantas, soma, maior), pedidos e bytes na janela da ação.
- **INP / LCP.** Calculados com `PerformanceObserver` sem a biblioteca web-vitals: INP = maior duração
  de evento por interação na janela (com menos de 50 interações o INP oficial também é o máximo); LCP
  só existe em carregamento de documento e para na primeira interação.

### O que cada ação faz (nunca salva, exporta, bloqueia ou manda comando)

| Ação | Nosso painel | RDV |
|---|---|---|
| login | `/login` → e-mail/senha do `.env.perf` → `/dashboard` pronto | medido só quando o dono acabou de digitar (1ª rodada) |
| abrir-painel | `/dashboard` sem skeleton | `/dashboard/` (Conectividade) com cartões numéricos |
| abrir-mapa | `/mapa` com grupos/marcadores | `/rastreamento/` com marcadores |
| buscar-placa | digita `PERF_PLACA` na busca lateral → card da placa no topo | campo de busca heurístico + Enter → placa na tela e XHR com o termo |
| abrir-detalhe | clica no card → painel com placa, endereço resolvido e hora | clica no card → ficha/popup novo (heurístico) |
| abrir-historico | cockpit → Histórico → Consultar → 24 horas → **Buscar** (B conta a partir do Buscar) | botão "Histórico/Viagens" → Consultar → 24 h → Consultar (≤ 24 h, síncrono) |
| abrir-estoque | `/estoque` com linhas | `/equipamentosDisponiveis/` com linhas |
| buscar-imei | digita `PERF_IMEI` → primeira linha é o IMEI | campo de busca heurístico + Enter → IMEI na tela |
| abrir-estoque-mapa | `/estoque/mapa` com marcadores e cards | `/rastreamento/v2/?tipo=estoque` com marcadores |

Na RDV, quando a heurística não acha o elemento, a ação sai como **"sem equivalente identificado:
&lt;passo&gt;"** — nunca com um tempo inventado. Na primeira rodada, confira essas linhas e ajuste o
objeto `RDV` no topo da parte da RDV em `medir-experiencia.mjs`. Texto ou `onclick` com bloquear,
excluir, cancelar, enviar, salvar, comando, retirar, exportar etc. nunca é clicado.

## `comparar.mjs`

```bash
node scripts/perf/comparar.mjs \
  --antes  scripts/perf/resultados/2026-10-14T10-00-00-nosso.json \
  --depois scripts/perf/resultados/2026-10-20T10-00-00-nosso.json \
  --rdv    scripts/perf/resultados/2026-10-20T10-00-00-rdv.json
```

Situação: "Não testado — acesso pendente" (nada medido) · "Aguardando publicação ou aprovação" (sem
"depois" ou "depois" fora de produção) · "Validado e dentro da meta" · "Melhorou, abaixo da meta" ·
"Inconclusiva" · "Piorou — investigar". Metas: navegação B p75 ≤ 2,5 s; interação A p95 ≤ 100 ms e
INP p75 ≤ 200 ms. Regras completas no cabeçalho do script.

## `provar-cluster-estoque.mjs` (F4) e `uso-prolongado-estoque.mjs` (F5)

```bash
MSYS_NO_PATHCONV=1 node scripts/perf/provar-cluster-estoque.mjs --base http://localhost:3000 --nivel 2 --flags "NEXT_PUBLIC_STOCK_MAP_CLUSTER=on"
MSYS_NO_PATHCONV=1 node scripts/perf/uso-prolongado-estoque.mjs --base http://localhost:3000 --nivel 2 --minutos 20
```

O F4 não precisa de gancho no código do painel: enquadra com o botão "Ver todos", lê os pontos da
própria resposta de `/stock/map` e distingue grupo (`data-total`) de ponto (`data-chave`) pelo DOM. O
F5 passa se, em toda janela de 90 s do período parado, a soma das long tasks ficar abaixo de 3.000 ms
e nenhuma passar de 300 ms. Os dois saem com código 0 (tudo PASS) ou 1 (algum FAIL).

## Regras de honestidade (valem para toda medição)

- **Declare o nível** (1–4) e as flags; o script recusa rodar sem `--nivel` e grava versão do backend
  (`/api/v1/health`), build do frontend e navegador em cada resultado.
- **Mesma máquina, mesmo navegador, mesma rede** para os dois lados da comparação; sessões separadas.
- **Rodadas alternadas** (`--alvo nosso,rdv`): na rodada ímpar um vai primeiro, na par o outro.
- **Frio e quente separados**: nunca misture os dois numa mesma tabela (o `comparar.mjs` avisa).
- **Mediana e p95**; p99 só com 20 amostras ou mais.
- **Inconclusiva** quando |diferença| < max(espalhamento p95 − mediana, 10 % da maior mediana).
- **Volumes diferentes** (marcadores, linhas, cards) ficam registrados em `volume` — a RDV tem outro
  tamanho de base, e isso entra na leitura.
- **RDV**: só a conta do dono, senha digitada por ele, ritmo normal, só leitura, nenhuma carga.
- Resolução de A e B: 50 ms. "Frio" limpa o cache HTTP, mas mantém sessão, `localStorage` e service
  worker — não é a primeira visita absoluta.
