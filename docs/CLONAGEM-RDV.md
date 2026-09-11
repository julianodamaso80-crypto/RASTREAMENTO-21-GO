# Copiar uma tela da RedeVeiculos sem achismo

Método e ferramentas para reproduzir aqui um módulo do painel da plataforma de
origem (`21go.rastreamento.vip`), que é o que o dono pede desde 10/09/2026
("exatamente igual").

## O que existe pronto no mundo (pesquisado em 11/09/2026)

Não existe repositório público da RedeVeiculos — a plataforma é fechada. O que
existe são **ferramentas de clonagem de site**, e foram avaliadas estas:

| Repositório | Serve? | Por quê |
|---|---|---|
| [JCodesMore/ai-website-cloner-template](https://github.com/JCodesMore/ai-website-cloner-template) (MIT, 34k★) | **Parcialmente — é a melhor** | Skill de clonagem para agente, e o alvo dela é **Next.js + shadcn/ui + Tailwind**, a nossa stack. A disciplina dela virou a nossa: valor exato de `getComputedStyle`, **todo estado e não só o inicial**, e ficha escrita antes de construir. Só clona página pública: login, permissão e backend estão fora do escopo dela. |
| [Jane-xiaoer/claude-skill-web-clone](https://github.com/Jane-xiaoer/claude-skill-web-clone) (MIT, 1k★) | **Só os scripts** | Metodologia para site de marketing/WebGL, com um bom `visual-diff`. O `scripts/clonagem/diff-visual.mjs` daqui é adaptação dele. O texto declara que **não promete clonar login, permissão e lógica de servidor** — o nosso caso inteiro. |
| [abi/screenshot-to-code](https://github.com/abi/screenshot-to-code) (MIT, 78k★) | Não | Captura → HTML/Tailwind por LLM. Chuta valor e não enxerga comportamento, opção de select nem endpoint. Bom para landing page, ruim para painel de operação. |
| [firecrawl/open-lovable](https://github.com/firecrawl/open-lovable) (MIT, 28k★) | Não | Recria site em React a partir da **URL pública**. A RDV exige login. |
| [awssat/tailwindo](https://github.com/awssat/tailwindo) (MIT) | Talvez, pontual | Converte classe Bootstrap → Tailwind. A RDV é Bootstrap 5; útil para traduzir um trecho de markup, não a tela toda (o `.btn-primary` deles não é o nosso primário). |
| goclone, HTTrack, SingleFile, obelisk | Não | Espelham HTML/CSS de página pública. O valor da RDV está no JS e nos endpoints atrás do login. |

**Conclusão:** nenhuma ferramenta clona sozinha um painel com login. O que se
aproveita é o **método** — e ele virou os dois scripts abaixo.

## As duas ferramentas nossas

### 1. Reconhecimento — `scripts/clonagem/recon-rdv.mjs`

```bash
MSYS_NO_PATHCONV=1 RDV_USER=<usuário> RDV_PASS=<senha> \
  node scripts/clonagem/recon-rdv.mjs --rota /guardiao/ --saida docs/clonagem/guardiao \
  [--clicar '#main-content .nav-link']
```

> O `MSYS_NO_PATHCONV=1` é obrigatório no Git Bash: sem ele, `/guardiao/` vira
> caminho do Windows e o erro parece DNS.

Entra com o login do dono e grava em `--saida`:

- `telas/desktop|tablet|mobile.png` — captura inteira em 1440, 768 e 390.
- `inventario.json` — **o que mais importa**: abas, todos os `select` com todas
  as opções, todos os campos com tipo e placeholder, botões com `onclick`,
  rótulos, colunas de tabela.
- `estilos.json` — valor exato de `getComputedStyle` (nunca "parece 16px").
- `rede.json` — cada resposta de controller, com corpo: é o contrato de dados.
- `html.html`, `texto.txt`, `console-erros.json`.
- Com `--clicar`, repete captura + inventário **por aba**.

**Regra de segurança:** é a conta real do dono num sistema em produção. O script
só clica quando você passa `--clicar` com um seletor — e passe apenas seletor de
aba. Clique solto apaga OS de verdade.

### 2. Comparação — `scripts/clonagem/diff-visual.mjs`

```bash
node scripts/clonagem/diff-visual.mjs --origem antes.png --nosso depois.png \
  --saida diff.json --imagem diff.png
```

Dá nota de 1 a 5 e a porcentagem de pixels diferentes.

**Onde ele vale:** regressão da NOSSA tela entre duas versões (medido: tela
igual a si mesma = 5/5 com 0,0%; a mesma tela com o painel de filtros aberto =
3/5 com 11,1%).

**Onde ele não vale:** comparar a nossa tela com a da RDV. Os temas são
diferentes (eles claro/Bootstrap, nós navy) e o conteúdo também — deu 87% de
diferença em telas que estão corretas. Para "ficou igual?" contra a origem,
quem responde é a conferência campo a campo do `inventario.json`.

## Ler o JavaScript deles — a parte que mais rende

As regras que decidem o comportamento não aparecem em captura de tela nenhuma:
teto de 90 dias, 10 OS por rota, 20 por PDF, excluir só OS aberta. Tudo isso
estava no JS da plataforma. Os arquivos ficam em
`/js/<modulo>/<Modulo>Controller.js` e `/js/<modulo>/<Modulo>Component.min.js`.

**Atalho que não existe:** a RDV **não publica source map** (conferido em
11/09/2026 nos três arquivos da agenda). Se um dia publicar, é o caminho mais
curto — o código original sai inteiro, com os nomes de verdade.

Sem source map, duas ferramentas resolvem, nesta ordem:

### 1. `webcrack` — desminifica de graça (j4k0xb/webcrack, MIT)

```bash
npx webcrack@latest AgendamentosComponent.min.js -o saida/
```

Não usa LLM, não custa nada, roda em segundos. No arquivo da agenda foram
**3.806 transformações**. O ganho medido: a regra do período estava numa linha
de 1.200 caracteres com ternários encadeados

```js
l.isBefore(i) ? Notiflix.Notify.warning("A data de início...") : l.diff(i, "days") > 90 ? ...
```

e virou `if / else if / else` legível. **Use sempre isto antes de ler.**

### 2. `humanify` — troca `D`, `H`, `K` por nome de gente (jehna/humanify, MIT)

```bash
# binário de Windows em github.com/jehna/humanify/releases (2,4 MB, sem instalar nada)
OPENROUTER_API_KEY=<a chave que o backend já usa> \
  ./humanify.exe openrouter saida/deobfuscated.js -m openai/gpt-4.1-mini -o legivel.js --progress
```

⚠️ **O `-m` não é opcional.** O modelo padrão do preset OpenRouter
(`openai/gpt-oss-120b`) devolve raciocínio no lugar de JSON e o humanify aborta
com `message.content was not a string`. Com `openai/gpt-4.1-mini` passou
limpo.

**Medido em 11/09/2026** no `TecnicosComponent.min.js` (41 KB, 47 KB depois do
webcrack): **122 identificadores renomeados, US$ 0,012 e ~12 minutos.** O ganho:

```js
const s = function (o) { ... }                         // antes
const formatTechnicianLabel = (count2, customLabels)   // depois
$.get("/tecnicos/TecnicosController", evaluationDates, function (analysisData)
```

⚠️ **Nome renomeado é hipótese, não verdade.** O LLM chuta pelo uso; quem manda
continua sendo o comportamento no arquivo. Serve para ler rápido, não para
citar como prova.

**O que não serve:** `getfrontend` (é para SPA com chunks; a RDV é jQuery com
arquivo por módulo) e conversores de HAR em OpenAPI — o nosso `recon-rdv.mjs`
já guarda o corpo de cada resposta, que é o que precisamos.

## O roteiro (o que deu certo na agenda, em 10 e 11/09)

1. **Recon da tela na origem** — roda o script acima, uma pasta por módulo.
2. **Ler o JS deles**, não só a tela. As regras que não aparecem em captura
   nenhuma estavam no `AgendamentosComponent.min.js`: só excluir OS agendada,
   teto de 90 dias, máximo de 10 OS por rota, 20 por emissão de PDF. Os
   arquivos ficam em `/js/<modulo>/<Modulo>Controller.js`.
3. **Escrever a ficha antes de codar** — campos, opções, estados, regras, com o
   valor medido ao lado. Sem ficha, o que falta vira invenção.
4. **Construir na nossa stack**, com os nossos nomes (enum em inglês, tela em
   PT-BR) e a nossa identidade visual — cópia fiel é de **comportamento e
   campo**, não de CSS.
5. **Provar** — teste de regra no backend, `tsc`, lint, e navegador de verdade
   com console limpo. Depois, `diff-visual` contra a versão anterior da nossa
   tela.
6. **Anotar onde ficou diferente de propósito** (e por quê). No módulo da
   agenda: sem checklist, sem PDF oficial, relatório de pagamentos sem
   deslocamento.

## Já capturado

- `docs/clonagem/guardiao/` — Guardião (Wave 2.1 do roadmap): 3 abas
  (A tratar / Tratados / Desabilitados, com **3.225 ativos a tratar** na conta
  deles), filtros de data e hora, GPRS × GPS, "sem inadimplente", "nunca
  pontuou", "acionamento guardião", paginação de 20 a 500 e o endpoint
  `/guardiao/GuardiaoController`.
