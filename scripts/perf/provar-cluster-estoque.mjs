#!/usr/bin/env node
/**
 * F4 — prova do agrupamento (cluster) do mapa do estoque, com captura de tela.
 *
 * Checagens (cada uma imprime PASS/FAIL):
 *   1. Enquadrar todos ("Ver todos" = fitAll do StockMapRef) → soma dos totais
 *      dos grupos + pontos soltos = pontos com coordenada no payload /stock/map.
 *   2. Buscar PERF_IMEI na lista → o card do item aparece (mesmo que o ponto
 *      dele esteja dentro de um grupo no mapa; o script diz se estava).
 *   3. Selecionar o card → o pino do item aparece, dentro da área do mapa.
 *   4. Clicar no maior grupo (zoom até expandir) → o grupo se desfaz em grupos
 *      menores e/ou pontos soltos.
 *   5. Trocar o mapa base para "Satélite grátis" → os marcadores continuam.
 *
 * Sem gancho no código do painel: o enquadramento é o botão "Ver todos"
 * (app/(dashboard)/estoque/mapa/page.tsx), os pontos vêm da própria resposta
 * de /stock/map interceptada aqui, e os marcadores se distinguem pelo DOM do
 * stock-map-container.tsx — grupo = `.maplibregl-marker[data-total]`, ponto =
 * `.maplibregl-marker[data-chave]` (o texto do grupo arredonda "1k"; o
 * `data-total` é exato). Por isso funciona igual nos níveis 2, 3 e 4.
 *
 * Uso:
 *   MSYS_NO_PATHCONV=1 node scripts/perf/provar-cluster-estoque.mjs \
 *     --base http://localhost:3000 --nivel 2 [--flags "STOCK_MAP_CLUSTER=on"] [--visivel]
 *   Env: PERF_USER, PERF_PASS, PERF_IMEI (em .env.perf).
 *   Capturas: docs/clonagem/perf/ (fora do git).
 */
import path from 'node:path';
import {
  abrirNavegador,
  carimbo,
  carregarEnvPerf,
  dorme,
  entrarNoPainel,
  esperar,
  exigirNivel,
  instrumentar,
  lerArgs,
  NIVEIS,
  OCUPADO_NOSSO,
  pastaDeSaida,
  RAIZ,
  versaoDoPainel,
} from './comum.mjs';

const resultados = [];
function checar(nome, ok, detalhe) {
  resultados.push({ nome, ok, detalhe });
  console.log(`${ok === null ? 'N/A ' : ok ? 'PASS' : 'FAIL'}  ${nome} — ${detalhe}`);
}

/** Marcadores do mapa do estoque, contados pelo DOM. */
const CONTAR = () => {
  const grupos = [...document.querySelectorAll('.maplibregl-marker[data-total]')];
  return {
    grupos: grupos.length,
    soltos: document.querySelectorAll('.maplibregl-marker[data-chave]').length,
    somaGrupos: grupos.reduce((s, e) => s + Number(e.dataset.total || 0), 0),
    maiorGrupo: grupos.reduce((m, e) => Math.max(m, Number(e.dataset.total || 0)), 0),
  };
};

/** Espera o mapa parar de mexer (contagem igual em 3 leituras seguidas). */
async function assentar(pagina, minimoMs = 1200) {
  await dorme(minimoMs);
  let anterior = '';
  for (let i = 0; i < 30; i += 1) {
    const atual = JSON.stringify(await pagina.evaluate(CONTAR));
    if (atual === anterior) return JSON.parse(atual);
    anterior = atual;
    await dorme(400);
  }
  return JSON.parse(anterior);
}

async function clicarBotaoComTexto(pagina, re) {
  const h = await pagina.evaluateHandle((fonte) => {
    return (
      [...document.querySelectorAll('button')].find((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && new RegExp(fonte).test(b.innerText.trim());
      }) || null
    );
  }, re.source);
  const el = h.asElement();
  if (!el) throw new Error(`botão ${re} não encontrado`);
  await el.click();
}

async function main() {
  carregarEnvPerf();
  const o = lerArgs(
    process.argv.slice(2),
    { base: process.env.PERF_BASE || 'http://localhost:3000', nivel: '', flags: '', saida: 'docs/clonagem/perf' },
    ['visivel'],
  );
  const nivel = exigirNivel(o.nivel);
  const imei = process.env.PERF_IMEI;
  if (!imei) throw new Error('Faltou PERF_IMEI (ambiente ou .env.perf).');
  const base = o.base.replace(/\/$/, '');
  const dir = pastaDeSaida(path.isAbsolute(o.saida) ? o.saida : path.join(RAIZ, o.saida));
  const prefixo = `${carimbo()}-cluster-estoque`;
  const foto = (pagina, n, nome) => pagina.screenshot({ path: path.join(dir, `${prefixo}-${n}-${nome}.png`) });

  const navegador = await abrirNavegador({ visivel: o.visivel });
  const pagina = (await navegador.pages())[0] || (await navegador.newPage());
  const coletor = await instrumentar(pagina);

  // A última resposta de /stock/map: é dela que sai o "pontos com coordenada".
  let ultimoPayload = null;
  pagina.on('response', async (r) => {
    if (!/\/api\/v1\/stock\/map(\?|$)/.test(r.url()) || r.status() !== 200) return;
    try {
      const j = await r.json();
      const d = j.data || j;
      if (Array.isArray(d.pontos)) ultimoPayload = { pontos: d.pontos, geradoEm: d.geradoEm ?? null, em: Date.now() };
    } catch {
      /* corpo indisponível (navegação) */
    }
  });

  try {
    await entrarNoPainel(pagina, base);
    await esperar(pagina, (oc) => (location.pathname === '/dashboard' && !window.__perfUtil.algumVisivel(oc) ? Date.now() : false), OCUPADO_NOSSO, 90000);
    const versao = await versaoDoPainel(base, pagina);
    console.log(`nível ${nivel} (${NIVEIS[nivel]}) · ${base} · backend ${versao.backend} · frontend ${versao.frontend} · flags ${o.flags || '—'}\n`);

    await pagina.goto(`${base}/estoque/mapa`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await esperar(pagina, () => (document.querySelector('.maplibregl-marker') ? Date.now() : false), null, 90000);
    for (let i = 0; i < 40 && !ultimoPayload; i += 1) await dorme(250);
    if (!ultimoPayload) throw new Error('não capturei a resposta de /stock/map');

    // ── 1. soma dos totais
    let contagem;
    let comCoord;
    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      await clicarBotaoComTexto(pagina, /^Ver todos$/);
      contagem = await assentar(pagina);
      comCoord = ultimoPayload.pontos.filter((p) => p.latitude !== null && p.longitude !== null).length;
      if (contagem.somaGrupos + contagem.soltos === comCoord) break;
      // Um recarregamento de 15 s pode ter trocado a lista no meio: mais uma vez.
      await dorme(2000);
    }
    await foto(pagina, 1, 'enquadrado');
    const modo = contagem.grupos > 0 ? 'cluster ligado' : 'sem grupos (flag NEXT_PUBLIC_STOCK_MAP_CLUSTER desligada ou pontos esparsos)';
    checar(
      '1. soma dos grupos + soltos = pontos com coordenada',
      contagem.somaGrupos + contagem.soltos === comCoord,
      `${contagem.grupos} grupos somando ${contagem.somaGrupos} + ${contagem.soltos} soltos = ${contagem.somaGrupos + contagem.soltos}; payload: ${comCoord} com coordenada de ${ultimoPayload.pontos.length} (${modo})`,
    );

    // ── 2. busca por IMEI
    const soltoAntes = await pagina.evaluate(
      (i) => [...document.querySelectorAll('.maplibregl-marker[data-chave]')].some((m) => (m.textContent || '').includes(i)),
      imei,
    );
    const ponto = ultimoPayload.pontos.find((p) => p.imei === imei);
    await pagina.type('input[placeholder^="IMEI, ICCID"]', imei);
    let achou = false;
    try {
      await esperar(
        pagina,
        (i) =>
          [...document.querySelectorAll('button span.font-mono.text-xs.font-semibold')].some((s) => s.textContent.trim() === i)
            ? Date.now()
            : false,
        imei,
        15000,
      );
      achou = true;
    } catch {
      achou = false;
    }
    checar(
      '2. busca pelo IMEI traz o item',
      achou,
      `${imei}: ${ponto ? (ponto.latitude !== null ? 'tem coordenada' : 'SEM coordenada') : 'não está no payload'}; no mapa estava ${soltoAntes ? 'como ponto solto' : 'dentro de um grupo (ou fora da tela)'}`,
    );

    // ── 3. selecionar → pino
    let pino = false;
    if (achou) {
      const card = await pagina.evaluateHandle(
        (i) => [...document.querySelectorAll('button span.font-mono.text-xs.font-semibold')].find((s) => s.textContent.trim() === i).closest('button'),
        imei,
      );
      await card.asElement().click();
      await dorme(1800);
      pino = await pagina.evaluate((i) => {
        const m = [...document.querySelectorAll('.maplibregl-marker[data-chave]')].find((x) => (x.textContent || '').includes(i));
        if (!m) return false;
        const r = m.getBoundingClientRect();
        const c = m.closest('.maplibregl-map').getBoundingClientRect();
        return r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom;
      }, imei);
    }
    await foto(pagina, 2, 'selecionado');
    checar('3. selecionar mostra o pino do item na área do mapa', pino, pino ? 'pino visível' : 'pino ausente ou fora da tela');

    // ── 4. zoom até expandir um grupo
    await pagina.click('input[placeholder^="IMEI, ICCID"]', { clickCount: 3 });
    await pagina.keyboard.press('Backspace');
    await clicarBotaoComTexto(pagina, /^Ver todos$/);
    let antes = await assentar(pagina);
    let expandiu = antes.grupos === 0 ? null : false;
    let detalheZoom = antes.grupos === 0 ? 'sem grupos na tela — nada a expandir' : '';
    for (let passo = 1; passo <= 4 && antes.grupos > 0 && !expandiu; passo += 1) {
      const alvo = antes.maiorGrupo;
      const grupo = await pagina.evaluateHandle(
        (t) => [...document.querySelectorAll('.maplibregl-marker[data-total]')].find((e) => Number(e.dataset.total) === t),
        alvo,
      );
      await grupo.asElement().click();
      const depois = await assentar(pagina, 900);
      expandiu = depois.maiorGrupo < alvo || depois.soltos > antes.soltos;
      detalheZoom = `passo ${passo}: grupo de ${alvo} → maior grupo ${depois.maiorGrupo}, soltos ${antes.soltos} → ${depois.soltos}`;
      antes = depois;
    }
    await foto(pagina, 3, 'zoom');
    checar('4. zoom no grupo expande em grupos menores/pontos', expandiu, detalheZoom);

    // ── 5. trocar mapa base
    const antesBase = await pagina.evaluate(CONTAR);
    await pagina.click('button[aria-label="Mudar mapa para Satélite grátis"]');
    const depoisBase = await assentar(pagina, 2500);
    await foto(pagina, 4, 'satelite');
    const totalAntes = antesBase.grupos + antesBase.soltos;
    const totalDepois = depoisBase.grupos + depoisBase.soltos;
    checar(
      '5. trocar para satélite mantém os marcadores',
      totalDepois > 0 && totalDepois === totalAntes,
      `marcadores ${totalAntes} → ${totalDepois}`,
    );
    // Devolve o mapa padrão: a escolha pode ficar guardada no navegador.
    await pagina.click('button[aria-label="Mudar mapa para Padrão"]').catch(() => {});

    const erros = coletor.log.console.length + coletor.log.falhas.length;
    console.log(`\nerros de console/rede durante a prova: ${erros}`);
  } finally {
    await navegador.close().catch(() => {});
  }

  const falhas = resultados.filter((r) => r.ok === false).length;
  const na = resultados.filter((r) => r.ok === null).length;
  console.log(`\n${resultados.length - falhas - na} PASS · ${falhas} FAIL · ${na} N/A · capturas em ${dir}`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(2);
});
