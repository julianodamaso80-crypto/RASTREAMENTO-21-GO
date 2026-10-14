#!/usr/bin/env node
/**
 * Mede a experiência do operador ação por ação, no nosso painel e na Rede
 * Veículos (RDV), do jeito que a pessoa sente — não o tempo da API.
 *
 * Para cada ação:
 *   A — da ação até a primeira mudança visual (quadro após a primeira mutação
 *       do DOM; numa troca de página, a primeira pintura com conteúdo, FCP);
 *   B — da ação até o "resultado utilizável" (seletor da ação presente, sem
 *       spinner/skeleton, ≥ 1 linha/marcador/card);
 *   C — idade do dado que a tela mostra (data/hora ou "há X minutos" escrito
 *       no card/painel × relógio);
 *   D — erros de console, pedidos que falharam, long tasks (quantas, soma,
 *       maior), INP aproximado e LCP, pedidos e bytes da janela.
 *
 * Uso (ver scripts/perf/README.md):
 *   MSYS_NO_PATHCONV=1 node scripts/perf/medir-experiencia.mjs \
 *     --alvo nosso,rdv --nivel 4 --rodadas 5 --modo quente \
 *     [--base https://trackgo.site] [--base-rdv https://21go.rastreamento.vip] \
 *     [--acoes login,abrir-painel,...] [--saida scripts/perf/resultados] \
 *     [--flags "STOCK_MAP_CLUSTER=on"] [--pausa 3000] [--visivel] [--perfil-cpu]
 *
 * RDV: janela VISÍVEL, o dono digita usuário e senha; o script só espera a
 * URL sair de /login e nunca lê nem grava os campos. Só leitura, ritmo de
 * gente (pausa entre ações), sem carga.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  abrirNavegador,
  apiDoPainel,
  armarMudanca,
  carimbo,
  carregarEnvPerf,
  compararMedianas,
  dorme,
  entrarNoPainel,
  esperar,
  estatistica,
  exigirNivel,
  idadeDoTexto,
  idadeLegivel,
  instrumentar,
  lerArgs,
  lerPrimeiroFeedback,
  lerVitais,
  ms,
  NIVEIS,
  OCUPADO_NOSSO,
  paraCsv,
  pastaDeSaida,
  POLLING_MS,
  TIPO_DA_ACAO,
  versaoDoPainel,
} from './comum.mjs';

const TODAS = [
  'login',
  'abrir-painel',
  'abrir-mapa',
  'buscar-placa',
  'abrir-detalhe',
  'abrir-historico',
  'abrir-estoque',
  'buscar-imei',
  'abrir-estoque-mapa',
];

const PRAZO_MS = 90000;
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ════════════════════════════════════════════════════════════ NOSSO PAINEL
// Seletores tirados do código (fontes no relatório da F8):
//   login        components/auth/login-form.tsx (#email, #password, submit → /dashboard)
//   painel       app/(dashboard)/dashboard/page.tsx (<h1>Dashboard</h1>, StatCard com Skeleton)
//   mapa         components/map/map-container.tsx (.vehicle-cluster, .vehicle-marker-container)
//   busca placa  components/vehicles/vehicle-sidebar.tsx (placeholder "Placa, nome, CPF, IMEI…")
//   card         components/vehicles/vehicle-list-item.tsx (span.font-semibold.text-sm = placa)
//   detalhe      components/vehicles/vehicle-detail-panel.tsx (h2 = placa, "Localização", "Buscando endereço…")
//   histórico    app/(dashboard)/veiculos/[id]/page.tsx (aba "Histórico") +
//                components/historico/historico-do-veiculo.tsx ("Consultar") +
//                components/historico/historico-consultar.tsx ("24 horas", "Buscar", "Ativo:", tabela)
//   estoque      app/(dashboard)/estoque/page.tsx (placeholder "Buscar por IMEI…", table tbody tr)
//   estoque/mapa app/(dashboard)/estoque/mapa/page.tsx + components/stock/stock-map-container.tsx
//                (.maplibregl-marker com data-total = grupo, data-chave = ponto)

const SEL = {
  buscaMapa: 'input[placeholder^="Placa, nome"]',
  buscaEstoque: 'input[placeholder^="Buscar por IMEI"]',
  // `text-foreground` separa o card do nome do usuário no cabeçalho
  // (components/layout/header.tsx usa text-sm font-semibold text-slate-100).
  placaNoCard: 'button span.font-semibold.text-sm.text-foreground',
  imeiNoCard: 'button span.font-mono.text-xs.font-semibold',
};

// Predicados rodam DENTRO da página: não enxergam nada deste arquivo, só o
// argumento. Devolvem Date.now() quando a condição vale (ver comum.esperar).
// Nada de varrer o DOM inteiro aqui — com 100 mil nós, varrer a cada 50 ms
// viraria long task e sujaria a própria medição.
const P = {
  painel: (ocupado) => {
    const U = window.__perfUtil;
    if (!U || location.pathname !== '/dashboard') return false;
    if (![...document.querySelectorAll('h1')].some((h) => h.textContent.trim() === 'Dashboard')) return false;
    return U.algumVisivel(ocupado) ? false : Date.now();
  },
  mapa: () => {
    const U = window.__perfUtil;
    if (!U || location.pathname !== '/mapa') return false;
    if (!document.querySelector('.vehicle-cluster, .vehicle-marker-container')) return false;
    return U.algumVisivel('[data-slot="skeleton"]') ? false : Date.now();
  },
  cardDaPlaca: ({ placa, sel }) => {
    const U = window.__perfUtil;
    if (!U || U.algumVisivel('[data-slot="skeleton"]')) return false;
    // O primeiro card da lista tem de ser a placa: antes da busca ela pode
    // até estar na lista, mas não filtrada no topo.
    const primeiro = document.querySelector(sel);
    if (!primeiro || !U.visivel(primeiro)) return false;
    return primeiro.textContent.toUpperCase().replace(/[^A-Z0-9]/g, '') === placa ? Date.now() : false;
  },
  detalhe: ({ placa }) => {
    const U = window.__perfUtil;
    if (!U) return false;
    const h2 = [...document.querySelectorAll('h2')].find(
      (h) => U.visivel(h) && h.textContent.toUpperCase().replace(/[^A-Z0-9]/g, '') === placa,
    );
    if (!h2) return false;
    const painel = h2.closest('.overflow-y-auto') || h2.parentElement.parentElement;
    const t = painel.innerText || '';
    if (!/Localiza/i.test(t) || /Buscando endere/i.test(t)) return false;
    return Date.now();
  },
  historico: () => {
    const U = window.__perfUtil;
    if (!U || U.algumVisivel('.animate-spin')) return false;
    const ativo = [...document.querySelectorAll('b')].find((b) => b.textContent.trim() === 'Ativo:' && U.visivel(b));
    return ativo ? Date.now() : false;
  },
  estoque: (ocupado) => {
    const U = window.__perfUtil;
    if (!U || location.pathname !== '/estoque') return false;
    if (U.algumVisivel(ocupado)) return false;
    const linha = document.querySelector('table tbody tr');
    return linha && U.visivel(linha) ? Date.now() : false;
  },
  linhaDoImei: ({ imei, ocupado }) => {
    const U = window.__perfUtil;
    if (!U || U.algumVisivel(ocupado)) return false;
    const linhas = document.querySelectorAll('table tbody tr');
    if (linhas.length === 0 || linhas.length > 50) return false;
    return (linhas[0].innerText || '').includes(imei) ? Date.now() : false;
  },
  estoqueMapa: (sel) => {
    const U = window.__perfUtil;
    if (!U || location.pathname !== '/estoque/mapa') return false;
    if (!document.querySelector('.maplibregl-marker')) return false;
    if (!document.querySelector(sel)) return false;
    return U.algumVisivel('.animate-spin') ? false : Date.now();
  },
};

async function irPara(ctx, rota, predicado, arg) {
  const t0 = Date.now();
  await ctx.pagina.goto(ctx.base + rota, { waitUntil: 'domcontentloaded', timeout: PRAZO_MS });
  const tUtil = await esperar(ctx.pagina, predicado, arg, PRAZO_MS);
  return { t0, tUtil };
}

/** Limpa um campo controlado pelo React e espera o debounce assentar. */
async function limparCampo(pagina, seletor) {
  await pagina.click(seletor, { clickCount: 3 });
  await pagina.keyboard.press('Backspace');
  await dorme(800);
}

const caminho = (pagina) => {
  try {
    return new URL(pagina.url()).pathname;
  } catch {
    return '';
  }
};

const NOSSO = {
  login: async (ctx) => {
    const t0 = await entrarNoPainel(ctx.pagina, ctx.base);
    const tUtil = await esperar(ctx.pagina, P.painel, OCUPADO_NOSSO, PRAZO_MS);
    return { t0, tUtil };
  },

  'abrir-painel': (ctx) => irPara(ctx, '/dashboard', P.painel, OCUPADO_NOSSO),

  'abrir-mapa': async (ctx) => {
    const r = await irPara(ctx, '/mapa', P.mapa);
    r.volume = await ctx.pagina.evaluate(() => {
      const grupos = [...document.querySelectorAll('.vehicle-cluster')];
      return {
        grupos: grupos.length,
        soltos: document.querySelectorAll('.vehicle-marker-container').length,
        somaGrupos: grupos.reduce((s, e) => s + Number(e.dataset.total || 0), 0),
      };
    });
    return r;
  },

  'buscar-placa': async (ctx) => {
    const placa = exigirEnv('PERF_PLACA');
    if (caminho(ctx.pagina) !== '/mapa') await NOSSO['abrir-mapa'](ctx);
    await ctx.pagina.waitForSelector(SEL.buscaMapa, { visible: true, timeout: PRAZO_MS });
    await limparCampo(ctx.pagina, SEL.buscaMapa);
    await armarMudanca(ctx.pagina);
    const t0 = Date.now();
    await ctx.pagina.type(SEL.buscaMapa, placa);
    const tUtil = await esperar(ctx.pagina, P.cardDaPlaca, { placa: norm(placa), sel: SEL.placaNoCard }, PRAZO_MS);
    const idadeTexto = await ctx.pagina.evaluate((sel) => {
      const span = document.querySelector(sel);
      return span ? window.__perfUtil.ultimaAtualizacao(span.closest('button')) : null;
    }, SEL.placaNoCard);
    return { t0, tUtil, idadeTexto };
  },

  'abrir-detalhe': async (ctx) => {
    const placa = norm(exigirEnv('PERF_PLACA'));
    const temCard =
      caminho(ctx.pagina) === '/mapa' &&
      (await ctx.pagina
        .evaluate(
          (p, sel) => {
            const s = document.querySelector(sel);
            return !!s && s.textContent.toUpperCase().replace(/[^A-Z0-9]/g, '') === p;
          },
          placa,
          SEL.placaNoCard,
        )
        .catch(() => false));
    if (!temCard) await NOSSO['buscar-placa'](ctx);
    const card = await ctx.pagina.$(SEL.placaNoCard);
    await armarMudanca(ctx.pagina);
    const t0 = Date.now();
    await card.click();
    const tUtil = await esperar(ctx.pagina, P.detalhe, { placa }, PRAZO_MS);
    const { idadeTexto, endereco } = await ctx.pagina.evaluate((p) => {
      const h2 = [...document.querySelectorAll('h2')].find(
        (h) => h.textContent.toUpperCase().replace(/[^A-Z0-9]/g, '') === p,
      );
      const painel = h2 && (h2.closest('.overflow-y-auto') || h2.parentElement.parentElement);
      return {
        idadeTexto: painel ? window.__perfUtil.ultimaAtualizacao(painel) : null,
        endereco: painel && /Endereço indisponível/.test(painel.innerText) ? 'indisponível' : 'ok',
      };
    }, placa);
    return { t0, tUtil, idadeTexto, volume: { endereco } };
  },

  'abrir-historico': async (ctx) => {
    // Caminho do operador: painel de detalhe → "Abrir cockpit completo" →
    // aba Histórico → Consultar → 24 horas → Buscar. O tempo medido é o do
    // Buscar (a espera que a pessoa sente); os cliques de navegação antes
    // dele não entram em B — dependem da velocidade do robô, não do sistema.
    let link = caminho(ctx.pagina) === '/mapa' ? await ctx.pagina.$('a[href^="/veiculos/"]') : null;
    if (!link) {
      await NOSSO['abrir-detalhe'](ctx);
      link = await ctx.pagina.$('a[href^="/veiculos/"]');
    }
    if (!link) throw new Error('link do cockpit não encontrado no painel de detalhe');
    await link.click();
    await clicarPorTexto(ctx.pagina, '[role="tab"]', /^Histórico$/);
    await clicarPorTexto(ctx.pagina, 'button', /^Consultar$/);
    await clicarPorTexto(ctx.pagina, 'button', /^24 horas$/);
    const buscar = await acharPorTexto(ctx.pagina, 'button', /^Buscar$/, true);
    if (!buscar) throw new Error('botão Buscar do histórico não apareceu');
    await armarMudanca(ctx.pagina);
    const t0 = Date.now();
    await buscar.click();
    const tUtil = await esperar(ctx.pagina, P.historico, null, PRAZO_MS);
    const { idadeTexto, linhas } = await ctx.pagina.evaluate(() => {
      const ativo = [...document.querySelectorAll('b')].find((b) => b.textContent.trim() === 'Ativo:');
      const area = ativo && ativo.closest('.space-y-2');
      const corpo = area && area.querySelector('tbody');
      return { idadeTexto: corpo ? corpo.innerText.slice(-4000) : null, linhas: corpo ? corpo.children.length : 0 };
    });
    return { t0, tUtil, idadeTexto, volume: { linhas } };
  },

  'abrir-estoque': async (ctx) => {
    const r = await irPara(ctx, '/estoque', P.estoque, OCUPADO_NOSSO);
    const extra = await ctx.pagina.evaluate(() => {
      const linhas = document.querySelectorAll('table tbody tr');
      const mostrando = [...document.querySelectorAll('p, div, span')].find(
        (e) => e.childElementCount === 0 && /^Mostrando \d+ de \d+/.test(e.textContent.trim()),
      );
      return {
        idadeTexto: linhas[0] ? linhas[0].innerText : null,
        volume: { linhas: linhas.length, mostrando: mostrando ? mostrando.textContent.trim() : null },
      };
    });
    return { ...r, ...extra };
  },

  'buscar-imei': async (ctx) => {
    const imei = exigirEnv('PERF_IMEI');
    if (caminho(ctx.pagina) !== '/estoque') await NOSSO['abrir-estoque'](ctx);
    await limparCampo(ctx.pagina, SEL.buscaEstoque);
    await armarMudanca(ctx.pagina, 'table');
    const t0 = Date.now();
    await ctx.pagina.type(SEL.buscaEstoque, imei);
    const tUtil = await esperar(ctx.pagina, P.linhaDoImei, { imei, ocupado: OCUPADO_NOSSO }, PRAZO_MS);
    const idadeTexto = await ctx.pagina.evaluate(() => {
      const l = document.querySelector('table tbody tr');
      return l ? l.innerText : null;
    });
    return { t0, tUtil, idadeTexto };
  },

  'abrir-estoque-mapa': async (ctx) => {
    const r = await irPara(ctx, '/estoque/mapa', P.estoqueMapa, SEL.imeiNoCard);
    const extra = await ctx.pagina.evaluate((sel) => {
      const grupos = [...document.querySelectorAll('.maplibregl-marker[data-total]')];
      const primeiro = document.querySelector(sel);
      return {
        idadeTexto: primeiro ? window.__perfUtil.ultimaAtualizacao(primeiro.closest('button')) : null,
        volume: {
          grupos: grupos.length,
          soltos: document.querySelectorAll('.maplibregl-marker[data-chave]').length,
          somaGrupos: grupos.reduce((s, e) => s + Number(e.dataset.total || 0), 0),
          cards: document.querySelectorAll(sel).length,
        },
      };
    }, SEL.imeiNoCard);
    return { ...r, ...extra };
  },
};


async function acharPorTexto(pagina, seletor, re, esperarAte = false) {
  const limite = Date.now() + (esperarAte ? PRAZO_MS : 0);
  for (;;) {
    const handles = await pagina.$$(seletor);
    for (const h of handles) {
      const ok = await h
        .evaluate((e, fonte) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && new RegExp(fonte).test(e.innerText.trim());
        }, re.source)
        .catch(() => false);
      if (ok) return h;
    }
    if (Date.now() >= limite) return null;
    await dorme(200);
  }
}

async function clicarPorTexto(pagina, seletor, re) {
  const h = await acharPorTexto(pagina, seletor, re, true);
  if (!h) throw new Error(`não achei ${seletor} com texto ${re}`);
  await h.click();
  await dorme(400);
}

function exigirEnv(nome) {
  const v = process.env[nome];
  if (!v) throw new Error(`Faltou ${nome} (ambiente ou .env.perf).`);
  return v;
}

// ═══════════════════════════════════════════════════════════ REDE VEÍCULOS
// URLs dos módulos: scripts/clonagem/varredura-rdv.mjs (MODULOS) e
// docs/AUDITORIA-RDV-2026-09.md; mapa do estoque `/rastreamento/v2/?tipo=estoque`
// (memória reference_rede_estoque_endereco). O DOM interno deles NÃO está
// documentado no repositório: os seletores abaixo são heurísticos e cada
// amostra grava `diagnostico` (o que achou) para ajuste na primeira rodada.
// Quando a heurística não acha o elemento, a ação sai como
// "sem equivalente identificado: <passo>" — nunca como tempo inventado.

const RDV = {
  rotas: {
    login: '/login?empresa=rdv&plataforma=web',
    painel: '/dashboard/',
    mapa: '/rastreamento/',
    estoque: '/equipamentosDisponiveis/',
    estoqueMapa: '/rastreamento/v2/?tipo=estoque',
  },
  ocupado:
    '.spinner-border, .spinner-grow, .fa-spin, .loading, .loader, .blockUI, .blockOverlay, #preloader, .preloader, .swal2-loading, .dataTables_processing',
  marcadores:
    '.leaflet-marker-icon, .marker-cluster, .maplibregl-marker, .mapboxgl-marker, .gm-style img[src*="marker"], .gm-style div[role="button"]',
  dialogos: '.modal.show, .leaflet-popup, .popover.show, .offcanvas.show, [role="dialog"], .gm-style-iw',
  campoBusca: 'placa|pesquis|busca|search|imei|chassi',
  // Texto/onclick que NUNCA é clicado: a conta é a real do dono, em produção.
  proibido: 'bloque|desbloq|exclu|remov|apag|cancel|enviar|salvar|comando|retirar|inativ|desativ|export|imprim|excel|pdf|transfer|vincul',
};

const PR = {
  pronto: ({ ocupado }) => {
    const U = window.__perfUtil;
    if (!U || document.readyState !== 'complete' || location.pathname.includes('login')) return false;
    return U.algumVisivel(ocupado) ? false : Date.now();
  },
  painel: ({ ocupado }) => {
    const U = window.__perfUtil;
    if (!U || document.readyState !== 'complete' || U.algumVisivel(ocupado)) return false;
    const card = document.querySelector('.card-statistic-2');
    return card && U.visivel(card) && /\d/.test(card.innerText) ? Date.now() : false;
  },
  mapa: ({ ocupado, marcadores }) => {
    const U = window.__perfUtil;
    if (!U || document.readyState !== 'complete' || U.algumVisivel(ocupado)) return false;
    return document.querySelector(marcadores) ? Date.now() : false;
  },
  tabela: ({ ocupado }) => {
    const U = window.__perfUtil;
    if (!U || document.readyState !== 'complete' || U.algumVisivel(ocupado)) return false;
    const l = document.querySelector('tbody tr');
    return l && U.visivel(l) && !l.querySelector('.dataTables_empty') ? Date.now() : false;
  },
  textoNaTela: ({ alvo, ocupado }) => {
    const U = window.__perfUtil;
    if (!U || U.algumVisivel(ocupado)) return false;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.textContent.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(alvo) && U.visivel(n.parentElement)) {
        return Date.now();
      }
    }
    return false;
  },
  dialogoNovo: ({ antes, dialogos, ocupado }) => {
    const U = window.__perfUtil;
    if (!U || U.algumVisivel(ocupado)) return false;
    // O aviso de contrato também é um .modal — não conta como ficha aberta.
    const n = [...document.querySelectorAll(dialogos)].filter(
      (e) => U.visivel(e) && !/contrato|termo/i.test(e.innerText || ''),
    ).length;
    return n > antes ? Date.now() : false;
  },
  linhasNovas: ({ antes, ocupado }) => {
    const U = window.__perfUtil;
    if (!U || U.algumVisivel(ocupado)) return false;
    const n = [...document.querySelectorAll('tbody tr')].filter((l) => U.visivel(l) && !l.querySelector('.dataTables_empty')).length;
    return n > antes ? Date.now() : false;
  },
};

/** Remove só o aviso de contrato (cobre a tela de tempos em tempos). */
async function fecharAvisoContrato(pagina) {
  await pagina
    .evaluate(() => {
      const avisos = [...document.querySelectorAll('.modal')].filter((m) => /contrato|termo/i.test(m.innerText || ''));
      if (avisos.length === 0) return;
      avisos.forEach((m) => m.remove());
      document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('overflow');
    })
    .catch(() => {});
}

/** Espera os XHR/fetch disparados pela ação terminarem (rede quieta por 500 ms). */
async function esperarRedeQuieta(coletor, t0, prazoMs = 30000) {
  const limite = Date.now() + prazoMs;
  let quietoDesde = Date.now();
  while (Date.now() < limite) {
    if (coletor.abertosDesde(t0).length > 0) quietoDesde = Date.now();
    else if (Date.now() - quietoDesde >= 500) return { fim: coletor.ultimoFimXhr(t0), quieta: true };
    await dorme(POLLING_MS);
  }
  return { fim: coletor.ultimoFimXhr(t0), quieta: false };
}

/** Fim do primeiro pedido, depois de t0, cuja URL contém `trecho`. */
async function esperarPedidoCom(coletor, t0, trecho, prazoMs = 15000) {
  const limite = Date.now() + prazoMs;
  while (Date.now() < limite) {
    const r = coletor.log.pedidos.find((p) => p.inicio >= t0 && p.url.includes(trecho) && p.fim !== null);
    if (r) return r.fim;
    await dorme(POLLING_MS);
  }
  return null;
}

async function rdvIrPara(ctx, rota, predicado) {
  const t0 = Date.now();
  await ctx.pagina.goto(ctx.base + rota, { waitUntil: 'domcontentloaded', timeout: PRAZO_MS });
  if (ctx.pagina.url().includes('login')) throw new Error('sessão da RDV caiu (voltou ao login)');
  const tDom = await esperar(ctx.pagina, predicado, { ocupado: RDV.ocupado, marcadores: RDV.marcadores }, PRAZO_MS);
  const rede = await esperarRedeQuieta(ctx.coletor, t0);
  await fecharAvisoContrato(ctx.pagina);
  return { t0, tUtil: Math.max(tDom, rede.fim), redeQuieta: rede.quieta };
}

/** Campo de busca visível cujo placeholder/nome/id lembra busca. */
async function campoDeBuscaRdv(pagina) {
  const handles = await pagina.$$('input[type="text"], input[type="search"], input:not([type])');
  for (const h of handles) {
    const ok = await h
      .evaluate((e, fonte) => {
        const r = e.getBoundingClientRect();
        const pista = `${e.placeholder} ${e.name} ${e.id} ${e.getAttribute('aria-label') || ''}`;
        return r.width > 0 && r.height > 0 && new RegExp(fonte, 'i').test(pista);
      }, RDV.campoBusca)
      .catch(() => false);
    if (ok) return h;
  }
  return null;
}

/** Já está na tela da rota? O mapa do estoque também mora em /rastreamento. */
function rdvEstaEm(url, rota) {
  if (rota === RDV.rotas.mapa) return url.includes('/rastreamento') && !url.includes('tipo=estoque');
  return url.includes(rota.split('?')[0]);
}

async function rdvBuscar(ctx, termo, rota, predicadoPagina) {
  if (!rdvEstaEm(ctx.pagina.url(), rota)) await rdvIrPara(ctx, rota, predicadoPagina);
  await fecharAvisoContrato(ctx.pagina);
  const campo = await campoDeBuscaRdv(ctx.pagina);
  if (!campo) return { semEquivalente: 'campo de busca não identificado na tela' };
  await campo.click({ clickCount: 3 });
  await ctx.pagina.keyboard.press('Backspace');
  await dorme(800);
  await armarMudanca(ctx.pagina);
  const t0 = Date.now();
  await campo.type(termo);
  // Enter num campo de busca só pesquisa; nenhum formulário de escrita é tocado.
  await ctx.pagina.keyboard.press('Enter');
  const tPedido = await esperarPedidoCom(ctx.coletor, t0, encodeURIComponent(termo));
  const tDom = await esperar(ctx.pagina, PR.textoNaTela, { alvo: norm(termo), ocupado: RDV.ocupado }, PRAZO_MS);
  const rede = await esperarRedeQuieta(ctx.coletor, t0);
  return {
    t0,
    tUtil: Math.max(tDom, tPedido || 0, rede.fim),
    redeQuieta: rede.quieta,
    diagnostico: { pedidoComTermo: tPedido !== null },
  };
}

/** Elemento visível com o texto, subindo até algo clicável e seguro. */
async function clicavelComTexto(pagina, alvoNorm) {
  return pagina.evaluateHandle(
    (alvo, proibido) => {
      const U = window.__perfUtil;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const el = n.parentElement;
        if (!el || el.closest('input, textarea, select') || !U.visivel(el)) continue;
        if (!n.textContent.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(alvo)) continue;
        // Sobe até algo clicável. Card de lista é julgado só pelo `onclick`
        // (o texto dele pode dizer "Bloqueado" como status); botão e link,
        // também pelo próprio texto.
        const re = new RegExp(proibido, 'i');
        let c = el;
        for (let i = 0; i < 6 && c && c !== document.body; i += 1, c = c.parentElement) {
          const onclick = c.getAttribute('onclick') || '';
          const ehBotao = c.tagName === 'A' || c.tagName === 'BUTTON' || c.getAttribute('role') === 'button';
          const clicavel = ehBotao || onclick || /card|item|row|lista/i.test(String(c.className || ''));
          if (!clicavel) continue;
          if (re.test(onclick) || (ehBotao && re.test(c.innerText || ''))) return null;
          return c;
        }
        return el;
      }
      return null;
    },
    alvoNorm,
    RDV.proibido,
  );
}

async function botaoSeguro(pagina, re, excluirAbas = false) {
  return pagina.evaluateHandle(
    (fonte, proibido, excluir) => {
      const U = window.__perfUtil;
      const cands = [...document.querySelectorAll('button, a, .btn, [role="tab"], .nav-link')].filter((e) => {
        const t = (e.innerText || '').trim();
        return U.visivel(e) && t.length <= 40 && new RegExp(fonte, 'i').test(t);
      });
      const ehAba = (e) =>
        e.getAttribute('role') === 'tab' || e.classList.contains('nav-link') || !!e.closest('.nav-tabs, .nav-pills, [role="tablist"]');
      const seguros = cands.filter(
        (e) =>
          !new RegExp(proibido, 'i').test(`${e.innerText} ${e.getAttribute('onclick') || ''}`) && !(excluir && ehAba(e)),
      );
      return seguros[seguros.length - 1] || null;
    },
    re.source,
    RDV.proibido,
    excluirAbas,
  );
}

const elementoOuNulo = async (h) => (h && h.asElement ? h.asElement() : null);

const RDV_ACOES = {
  login: async (ctx) => {
    // Só mede o login que o dono acabou de fazer nesta sessão (ctx.login).
    if (!ctx.loginMedido || ctx.loginMedido.usado) return { semEquivalente: 'login só é medido quando o dono digita (1ª rodada)' };
    ctx.loginMedido.usado = true;
    return ctx.loginMedido;
  },
  'abrir-painel': (ctx) => rdvIrPara(ctx, RDV.rotas.painel, PR.painel),
  'abrir-mapa': async (ctx) => {
    const r = await rdvIrPara(ctx, RDV.rotas.mapa, PR.mapa);
    r.volume = await ctx.pagina.evaluate((s) => ({ marcadores: document.querySelectorAll(s).length }), RDV.marcadores);
    return r;
  },
  'buscar-placa': async (ctx) => {
    const r = await rdvBuscar(ctx, exigirEnv('PERF_PLACA'), RDV.rotas.mapa, PR.mapa);
    if (r.semEquivalente) return r;
    r.idadeTexto = await textoPertoDe(ctx.pagina, norm(exigirEnv('PERF_PLACA')));
    return r;
  },
  'abrir-detalhe': async (ctx) => {
    const placa = norm(exigirEnv('PERF_PLACA'));
    if (!rdvEstaEm(ctx.pagina.url(), RDV.rotas.mapa)) {
      const b = await RDV_ACOES['buscar-placa'](ctx);
      if (b.semEquivalente) return b;
    }
    await fecharAvisoContrato(ctx.pagina);
    const alvo = await elementoOuNulo(await clicavelComTexto(ctx.pagina, placa));
    if (!alvo) return { semEquivalente: 'card da placa não identificado (ou só com ação proibida)' };
    const antes = await ctx.pagina.evaluate(
      (s) =>
        [...document.querySelectorAll(s)].filter(
          (e) => window.__perfUtil.visivel(e) && !/contrato|termo/i.test(e.innerText || ''),
        ).length,
      RDV.dialogos,
    );
    await armarMudanca(ctx.pagina);
    const t0 = Date.now();
    await alvo.click();
    let tDom;
    try {
      tDom = await esperar(ctx.pagina, PR.dialogoNovo, { antes, dialogos: RDV.dialogos, ocupado: RDV.ocupado }, 20000);
    } catch {
      return { semEquivalente: 'clique no card não abriu ficha/popup reconhecível' };
    }
    const rede = await esperarRedeQuieta(ctx.coletor, t0);
    const idadeTexto = await ctx.pagina.evaluate((s) => {
      const d = [...document.querySelectorAll(s)].filter((e) => window.__perfUtil.visivel(e)).pop();
      return d ? d.innerText.slice(0, 4000) : null;
    }, RDV.dialogos);
    return { t0, tUtil: Math.max(tDom, rede.fim), redeQuieta: rede.quieta, idadeTexto };
  },
  'abrir-historico': async (ctx) => {
    // "Viagens e históricos" → Consultar → 24h → Consultar/Buscar. ≤ 24 h é
    // síncrono na RDV (acima disso vira relatório assíncrono — não pedimos).
    const abrir = await elementoOuNulo(await botaoSeguro(ctx.pagina, /hist[oó]ric|viage/));
    if (!abrir) return { semEquivalente: 'botão de histórico não identificado na ficha' };
    await abrir.click();
    await dorme(1500);
    const aba = await elementoOuNulo(await botaoSeguro(ctx.pagina, /^consultar$/));
    if (aba) {
      await aba.click();
      await dorme(800);
    }
    const preset = await elementoOuNulo(await botaoSeguro(ctx.pagina, /^24\s*h(oras)?$/));
    if (!preset) return { semEquivalente: 'atalho de 24 h não identificado' };
    await preset.click();
    await dorme(400);
    const enviar = await elementoOuNulo(await botaoSeguro(ctx.pagina, /^(consultar|buscar|gerar|pesquisar|filtrar)$/, true));
    if (!enviar) return { semEquivalente: 'botão de consultar não identificado' };
    const antes = await ctx.pagina.evaluate(
      () => [...document.querySelectorAll('tbody tr')].filter((l) => window.__perfUtil.visivel(l) && !l.querySelector('.dataTables_empty')).length,
    );
    await armarMudanca(ctx.pagina);
    const t0 = Date.now();
    await enviar.click();
    let tDom;
    try {
      tDom = await esperar(ctx.pagina, PR.linhasNovas, { antes, ocupado: RDV.ocupado }, PRAZO_MS);
    } catch {
      return { semEquivalente: 'consulta de 24 h não trouxe linhas reconhecíveis' };
    }
    const rede = await esperarRedeQuieta(ctx.coletor, t0);
    const { idadeTexto, linhas } = await ctx.pagina.evaluate(() => {
      const corpo = [...document.querySelectorAll('tbody')].filter((b) => window.__perfUtil.visivel(b)).pop();
      return { idadeTexto: corpo ? corpo.innerText.slice(-4000) : null, linhas: corpo ? corpo.children.length : 0 };
    });
    return { t0, tUtil: Math.max(tDom, rede.fim), redeQuieta: rede.quieta, idadeTexto, volume: { linhas } };
  },
  'abrir-estoque': async (ctx) => {
    const r = await rdvIrPara(ctx, RDV.rotas.estoque, PR.tabela);
    Object.assign(
      r,
      await ctx.pagina.evaluate(() => {
        const l = document.querySelector('tbody tr');
        const info = document.querySelector('.dataTables_info');
        return {
          idadeTexto: l ? l.innerText : null,
          volume: { linhas: document.querySelectorAll('tbody tr').length, mostrando: info ? info.innerText.trim() : null },
        };
      }),
    );
    return r;
  },
  'buscar-imei': async (ctx) => {
    const r = await rdvBuscar(ctx, exigirEnv('PERF_IMEI'), RDV.rotas.estoque, PR.tabela);
    if (!r.semEquivalente) r.idadeTexto = await textoPertoDe(ctx.pagina, norm(exigirEnv('PERF_IMEI')));
    return r;
  },
  'abrir-estoque-mapa': async (ctx) => {
    const r = await rdvIrPara(ctx, RDV.rotas.estoqueMapa, PR.mapa);
    r.volume = await ctx.pagina.evaluate((s) => ({ marcadores: document.querySelectorAll(s).length }), RDV.marcadores);
    return r;
  },
};

/** Texto do bloco (até 4 níveis acima) que contém o termo — para a idade do dado. */
async function textoPertoDe(pagina, alvoNorm) {
  return pagina
    .evaluate((alvo) => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const el = n.parentElement;
        if (!el || el.closest('input, textarea')) continue;
        if (!n.textContent.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(alvo)) continue;
        let c = el;
        for (let i = 0; i < 4 && c.parentElement; i += 1) c = c.parentElement;
        return (c.innerText || '').slice(0, 2000);
      }
      return null;
    }, alvoNorm)
    .catch(() => null);
}

/** Espera o dono entrar na RDV na janela visível. Nunca toca nos campos. */
async function esperarLoginDoDono(ctx) {
  const marcas = [];
  await ctx.pagina.exposeFunction('__perfMarcaLogin', (t) => marcas.push(t));
  await ctx.pagina.evaluateOnNewDocument(() => {
    const marca = () => {
      if (location.pathname.includes('login') && window.__perfMarcaLogin) window.__perfMarcaLogin(Date.now());
    };
    document.addEventListener('submit', marca, true);
    document.addEventListener('keydown', (e) => e.key === 'Enter' && marca(), true);
    document.addEventListener(
      'click',
      (e) => e.target && e.target.closest && e.target.closest('button, input[type="submit"]') && marca(),
      true,
    );
  });
  await ctx.pagina.goto(ctx.base + RDV.rotas.login, { waitUntil: 'domcontentloaded', timeout: PRAZO_MS });
  if (!ctx.pagina.url().includes('login')) {
    console.log('[rdv] sessão já aberta neste perfil — login não será medido.');
    return null;
  }
  console.log('\n[rdv] Digite seu usuário e senha na janela do Chrome que abriu e entre.');
  console.log('[rdv] O script não lê nem grava o que você digita; só espera a URL sair de /login (até 5 min).\n');
  const tSaiu = await esperar(ctx.pagina, () => (location.pathname.includes('login') ? false : Date.now()), null, 300000);
  const t0 = marcas.filter((t) => t <= tSaiu).pop() ?? tSaiu;
  const tDom = await esperar(ctx.pagina, PR.pronto, { ocupado: RDV.ocupado }, PRAZO_MS);
  const rede = await esperarRedeQuieta(ctx.coletor, t0);
  await fecharAvisoContrato(ctx.pagina);
  return { t0, tUtil: Math.max(tDom, rede.fim), redeQuieta: rede.quieta, usado: false };
}

async function versaoDaRdv(pagina) {
  return pagina
    .evaluate(() => {
      const vs = [
        ...new Set(
          [...document.querySelectorAll('script[src], link[href]')]
            .map((e) => e.getAttribute('src') || e.getAttribute('href'))
            .map((u) => (u.match(/[?&]v(?:er|ersion)?=([^&]+)/) || [])[1])
            .filter(Boolean),
        ),
      ].slice(0, 3);
      return `title="${document.title}" assets v=${vs.join('|') || '?'}`;
    })
    .catch(() => 'desconhecida');
}

// ═════════════════════════════════════════════════════════════════ RUNNER

async function medirAcao(ctx, nome, acoes) {
  const inicio = new Date().toISOString();
  if (ctx.opcoes.modo === 'frio') await ctx.coletor.limparCache();
  let perfilAtivo = false;
  if (ctx.opcoes['perfil-cpu']) {
    try {
      await ctx.coletor.cdp.send('Profiler.enable');
      await ctx.coletor.cdp.send('Profiler.start');
      perfilAtivo = true;
    } catch {
      /* sem perfil nesta ação */
    }
  }
  let r;
  try {
    r = await acoes[nome](ctx);
  } catch (e) {
    r = { erro: String(e.message || e).slice(0, 200) };
  }
  if (perfilAtivo) {
    try {
      const { profile } = await ctx.coletor.cdp.send('Profiler.stop');
      const dir = pastaDeSaida(path.join(ctx.saida, 'perfis'));
      fs.writeFileSync(path.join(dir, `${ctx.carimbo}-${ctx.alvo}-r${ctx.rodada}-${nome}.cpuprofile`), JSON.stringify(profile));
    } catch {
      /* perfil perdido na troca de documento */
    }
  }

  const base = {
    alvo: ctx.alvo,
    rodada: ctx.rodada,
    acao: nome,
    tipo: TIPO_DA_ACAO[nome],
    modo: ctx.opcoes.modo,
    nivel: ctx.nivel,
    versao: ctx.versao,
    flags: ctx.opcoes.flags,
    perfil_cpu: perfilAtivo,
    inicio,
  };
  if (r.semEquivalente) return { ...base, ok: false, motivo: `sem equivalente identificado: ${r.semEquivalente}` };
  if (r.erro || !r.t0 || !r.tUtil) return { ...base, ok: false, motivo: r.erro || 'sem resultado' };

  const t1 = r.tUtil + 200;
  const tA = await lerPrimeiroFeedback(ctx.pagina, r.t0);
  const vitais = await lerVitais(ctx.pagina, r.t0, t1);
  const rede = ctx.coletor.resumo(r.t0, t1);
  const idade = idadeDoTexto(r.idadeTexto, r.tUtil);
  return {
    ...base,
    ok: true,
    motivo: null,
    A_ms: tA ? Math.max(0, Math.round(tA - r.t0)) : null,
    B_ms: Math.round(r.tUtil - r.t0),
    C_idade_s: idade ? idade.idade_s : null,
    C_faixa_s: idade ? idade.faixa : null,
    C_trecho: idade ? idade.trecho : null,
    erros_console: rede.errosConsole.length,
    falhas_rede: rede.falhas.length,
    ...vitais,
    reqs: rede.reqs,
    bytes: rede.bytes,
    rede_quieta: r.redeQuieta ?? null,
    volume: r.volume ?? null,
    diagnostico: r.diagnostico ?? null,
    detalhe_erros: [...rede.errosConsole.map((e) => e.texto), ...rede.falhas.map((f) => `${f.status} ${f.url.slice(0, 160)}`)].slice(0, 10),
  };
}

const COLUNAS = [
  'alvo', 'rodada', 'acao', 'tipo', 'modo', 'nivel', 'versao', 'flags', 'ok', 'motivo',
  'A_ms', 'B_ms', 'C_idade_s', 'C_faixa_s', 'C_trecho',
  'erros_console', 'falhas_rede', 'long_n', 'long_total_ms', 'long_max_ms', 'inp_ms', 'lcp_ms',
  'reqs', 'bytes', 'rede_quieta', 'volume', 'perfil_cpu', 'inicio',
];

function resumirPorAcao(amostras) {
  const porAcao = {};
  for (const a of amostras) {
    porAcao[a.acao] ??= [];
    porAcao[a.acao].push(a);
  }
  const res = {};
  for (const [acao, lista] of Object.entries(porAcao)) {
    // Amostra com perfil de CPU ligado é mais lenta por causa do perfil: fica
    // no CSV, mas não entra na estatística.
    const ok = lista.filter((x) => x.ok && !x.perfil_cpu);
    res[acao] = {
      tipo: TIPO_DA_ACAO[acao],
      n: lista.length,
      n_ok: ok.length,
      motivos: [...new Set(lista.filter((x) => !x.ok).map((x) => x.motivo))],
      A: estatistica(ok.map((x) => x.A_ms)),
      B: estatistica(ok.map((x) => x.B_ms)),
      C: estatistica(ok.map((x) => x.C_idade_s)),
      inp: estatistica(ok.map((x) => x.inp_ms)),
      lcp: estatistica(ok.map((x) => x.lcp_ms)),
      erros: ok.reduce((s, x) => s + (x.erros_console || 0) + (x.falhas_rede || 0), 0),
      long_max: Math.max(0, ...ok.map((x) => x.long_max_ms || 0)),
      long_total_mediana: estatistica(ok.map((x) => x.long_total_ms)).mediana,
      volume: ok.length ? ok[ok.length - 1].volume : null,
    };
  }
  return res;
}

function linhaResumo(acao, s) {
  if (!s || s.n_ok === 0) return `| ${acao} | 0/${s ? s.n : 0} | — | — | — | — | — | — | ${s && s.motivos.length ? s.motivos.join('; ') : '—'} |`;
  const p99 = s.B.p99 !== null ? ` · p99 ${ms(s.B.p99)}` : '';
  return `| ${acao} | ${s.n_ok}/${s.n} | ${ms(s.A.mediana)} / ${ms(s.A.p95)} | ${ms(s.B.mediana)} / ${ms(s.B.p95)}${p99} | ${idadeLegivel(s.C.mediana)} | ${s.erros} | ${ms(s.long_max)} | ${ms(s.inp.p75)} / ${ms(s.lcp.p75)} | ${s.motivos.join('; ') || '—'} |`;
}

function escreverResumo(arquivo, execucoes, opcoes) {
  const linhas = [];
  linhas.push(`# Medição de experiência — ${new Date().toLocaleString('pt-BR')}`, '');
  linhas.push(`Modo: **${opcoes.modo}** · rodadas: ${opcoes.rodadas} · flags declaradas: ${opcoes.flags || '—'} · máquina: ${os.hostname()} (${os.cpus()[0]?.model ?? '?'}, ${Math.round(os.totalmem() / 2 ** 30)} GB)`, '');
  for (const ex of execucoes) {
    linhas.push(`## ${ex.alvo === 'rdv' ? 'Rede Veículos' : 'Nosso painel'} — nível ${ex.nivel} (${NIVEIS[ex.nivel]})`, '');
    linhas.push(`Base: ${ex.base} · versão: ${ex.versao}`, '');
    linhas.push('| Ação | ok/n | A med / p95 | B med / p95 | C (idade) med | Erros | Long task máx | INP p75 / LCP p75 | Observação |');
    linhas.push('|---|---|---|---|---|---|---|---|---|');
    for (const acao of opcoes.listaAcoes) linhas.push(linhaResumo(acao, ex.resumo[acao]));
    linhas.push('');
  }
  if (execucoes.length === 2) {
    const [a, b] = execucoes;
    linhas.push(`## Comparação por ação (B, mediana) — ${a.alvo} × ${b.alvo}`, '');
    linhas.push('Regra: "inconclusiva" quando |diferença| < max(espalhamento p95−mediana, 10 % da maior mediana).', '');
    linhas.push(`| Ação | ${a.alvo} | ${b.alvo} | Diferença | Veredito para ${a.alvo} |`, '|---|---|---|---|---|');
    for (const acao of opcoes.listaAcoes) {
      const sa = a.resumo[acao];
      const sb = b.resumo[acao];
      const c = compararMedianas(sa && sa.B, sb && sb.B);
      linhas.push(`| ${acao} | ${ms(sa?.B.mediana)} | ${ms(sb?.B.mediana)} | ${c.diff === null ? '—' : ms(Math.abs(c.diff))} | ${c.veredito} |`);
    }
    linhas.push('');
  }
  linhas.push('Limitações: INP calculado à mão (maior duração por interação via PerformanceObserver `event`, sem a biblioteca web-vitals); LCP só existe em carregamento de documento; A e B têm resolução de 50 ms; "frio" = cache HTTP limpo antes de cada ação, com a sessão mantida.', '');
  fs.writeFileSync(arquivo, linhas.join('\n'), 'utf8');
}

async function prepararAlvo(alvo, opcoes, carimboExec) {
  const base = (alvo === 'rdv' ? opcoes['base-rdv'] : opcoes.base).replace(/\/$/, '');
  const visivel = alvo === 'rdv' || opcoes.visivel;
  const perfil =
    alvo === 'rdv' && !opcoes['rdv-novo-login'] ? path.join(os.tmpdir(), 'perf-rdv-perfil') : undefined;
  const navegador = await abrirNavegador({ visivel, perfil });
  const pagina = (await navegador.pages())[0] || (await navegador.newPage());
  const coletor = await instrumentar(pagina);
  const ctx = { alvo, base, navegador, pagina, coletor, opcoes, nivel: opcoes.nivel, carimbo: carimboExec, saida: opcoes.saidaAbs, amostras: [] };
  if (alvo === 'rdv') {
    ctx.loginMedido = await esperarLoginDoDono(ctx);
    ctx.versao = await versaoDaRdv(pagina);
  } else {
    await pagina.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: PRAZO_MS });
    const v = await versaoDoPainel(base, pagina);
    ctx.versao = `backend ${v.backend} · frontend ${v.frontend} · api ${apiDoPainel(base)}`;
    // Sem a ação "login" na lista, entra uma vez fora da medição.
    if (!opcoes.listaAcoes.includes('login')) {
      await entrarNoPainel(pagina, base);
      await esperar(pagina, P.painel, OCUPADO_NOSSO, PRAZO_MS);
    }
  }
  return ctx;
}

async function rodarRodada(ctx) {
  const acoes = ctx.alvo === 'rdv' ? RDV_ACOES : NOSSO;
  for (const nome of ctx.opcoes.listaAcoes) {
    const amostra = await medirAcao(ctx, nome, acoes);
    ctx.amostras.push(amostra);
    const txt = amostra.ok
      ? `A ${ms(amostra.A_ms)} · B ${ms(amostra.B_ms)} · C ${idadeLegivel(amostra.C_idade_s)} · erros ${amostra.erros_console + amostra.falhas_rede} · LT máx ${ms(amostra.long_max_ms)}`
      : amostra.motivo;
    console.log(`[${ctx.alvo}] rodada ${ctx.rodada} · ${nome}: ${txt}`);
    await dorme(ctx.opcoes.pausa);
  }
  // Entre as vezes deste alvo a aba fica parada em about:blank: um painel
  // aberto em segundo plano (polling, WebSocket) atrapalharia a medição do outro.
  await ctx.pagina.goto('about:blank').catch(() => {});
}

async function main() {
  carregarEnvPerf();
  const opcoes = lerArgs(
    process.argv.slice(2),
    {
      alvo: 'nosso',
      base: process.env.PERF_BASE || 'https://trackgo.site',
      'base-rdv': process.env.RDV_BASE || 'https://21go.rastreamento.vip',
      rodadas: 5,
      saida: 'scripts/perf/resultados',
      modo: 'quente',
      acoes: TODAS.join(','),
      nivel: '',
      flags: '',
      pausa: 3000,
      'pausa-rodada': 10000,
    },
    ['visivel', 'perfil-cpu', 'rdv-novo-login'],
  );
  opcoes.nivel = exigirNivel(opcoes.nivel);
  if (!['frio', 'quente'].includes(opcoes.modo)) throw new Error('--modo frio|quente');
  opcoes.listaAcoes = opcoes.acoes.split(',').map((s) => s.trim()).filter(Boolean);
  const desconhecidas = opcoes.listaAcoes.filter((a) => !TODAS.includes(a));
  if (desconhecidas.length) throw new Error(`Ações desconhecidas: ${desconhecidas.join(', ')}. Válidas: ${TODAS.join(', ')}`);
  const alvos = opcoes.alvo.split(',').map((s) => s.trim());
  if (alvos.some((a) => !['nosso', 'rdv'].includes(a))) throw new Error('--alvo nosso|rdv|nosso,rdv');
  if (opcoes.rodadas < 5) console.warn('Aviso: a regra pede ≥ 5 rodadas por função para comparar.');
  opcoes.saidaAbs = pastaDeSaida(opcoes.saida);
  const carimboExec = carimbo();

  const ctxs = [];
  for (const alvo of alvos) ctxs.push(await prepararAlvo(alvo, opcoes, carimboExec));

  try {
    for (let r = 1; r <= opcoes.rodadas; r += 1) {
      // Rodadas alternadas: na ímpar um alvo vai primeiro, na par o outro —
      // nenhum fica sempre com a rede/CPU "descansada".
      const ordem = r % 2 === 1 ? ctxs : [...ctxs].reverse();
      for (const ctx of ordem) {
        ctx.rodada = r;
        await rodarRodada(ctx);
      }
      if (r < opcoes.rodadas) await dorme(opcoes['pausa-rodada']);
    }
  } finally {
    const execucoes = [];
    for (const ctx of ctxs) {
      const resumo = resumirPorAcao(ctx.amostras);
      const meta = {
        alvo: ctx.alvo,
        base: ctx.base,
        nivel: ctx.nivel,
        nivelDescricao: NIVEIS[ctx.nivel],
        versao: ctx.versao,
        flags: opcoes.flags,
        modo: opcoes.modo,
        rodadas: opcoes.rodadas,
        acoes: opcoes.listaAcoes,
        maquina: { host: os.hostname(), cpu: os.cpus()[0]?.model, memGB: Math.round(os.totalmem() / 2 ** 30), so: `${os.platform()} ${os.release()}` },
        navegador: await ctx.navegador.version().catch(() => '?'),
        carimbo: carimboExec,
      };
      const nomeBase = path.join(opcoes.saidaAbs, `${carimboExec}-${ctx.alvo}`);
      fs.writeFileSync(`${nomeBase}.json`, JSON.stringify({ meta, resumo, amostras: ctx.amostras }, null, 1), 'utf8');
      fs.writeFileSync(`${nomeBase}.csv`, paraCsv(ctx.amostras, COLUNAS), 'utf8');
      execucoes.push({ ...meta, resumo });
      console.log(`resultado: ${nomeBase}.json / .csv`);
      await ctx.navegador.close().catch(() => {});
    }
    const arqResumo = path.join(opcoes.saidaAbs, `${carimboExec}-resumo.md`);
    escreverResumo(arqResumo, execucoes, opcoes);
    console.log(`resumo:    ${arqResumo}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
