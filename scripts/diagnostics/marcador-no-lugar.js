/**
 * Teste de regressão: o marcador do mapa está exatamente sobre a coordenada.
 *
 * Existe porque o mapa mostrava o veículo num lugar e o painel escrevia outro
 * endereço, e porque em alguns casos o veículo simplesmente não aparecia. Não
 * era timing nem geocoder: era o marcador desenhado no pixel errado.
 *
 * Três defeitos foram medidos aqui em 25/08/2026 e são o que este arquivo
 * impede de voltar:
 *
 *  1. `position:relative` inline no elemento do marcador vence o
 *     `position:absolute` da classe `.maplibregl-marker` do próprio MapLibre.
 *     Sem `absolute` o marcador entra no FLUXO do canvas-container e cada um
 *     empilha 54 px (a altura do ícone) abaixo do anterior: o 1º ficava certo,
 *     o 2º errava 238 m, o 5º errava 951 m. Com 350 veículos o erro passava de
 *     18 000 px e o veículo sumia da tela.
 *
 *  2. Trocar o nó DOM do marcador na marra (`el.replaceWith(novo)` +
 *     `marker._element = novo`) jogava o marcador para o canto superior
 *     esquerdo do mapa — 718 px, ~3 km — e o novo nó perdia a classe
 *     `maplibregl-marker`, então o erro era PERMANENTE, não até o próximo
 *     reposicionamento.
 *
 *  3. `map.setStyle()` NÃO remove marcador DOM no MapLibre 5. O re-attach
 *     manual que existia na troca de basemap era desnecessário e recriava o
 *     marcador na posição congelada de um deslize em curso.
 *
 * O teste lê o cssText direto de `map-container.tsx` — reintroduzir
 * `position:relative` lá derruba este teste.
 *
 * Rodar:  node scripts/diagnostics/marcador-no-lugar.js
 */
const fs = require('fs');
const path = require('path');
const url = require('url');
const puppeteer = require('puppeteer-core');

const RAIZ = path.resolve(__dirname, '..', '..');
/** Todo mapa que desenha rastreador entra aqui. Errar a posição em qualquer um
 *  deles é o mapa mentindo onde o veículo está. */
const FONTES = [
  ['mapa de veículos', 'frontend/dashboard/src/components/map/map-container.tsx'],
  ['mapa do estoque', 'frontend/dashboard/src/components/stock/stock-map-container.tsx'],
  ['rastro da TAG', 'frontend/dashboard/src/components/ble-tags/tag-trail-map.tsx'],
];
const MAPLIBRE_VERSAO = '5.21.1';
const CACHE = path.join(__dirname, '.cache-maplibre');

/** Tolerância: 2 px. O arredondamento do próprio MapLibre já gasta 1 px. */
const TOLERANCIA_PX = 2;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => fs.existsSync(p));

/** O cssText que o código de produção aplica no elemento do marcador. */
function cssDoCodigo(relativo) {
  const src = fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
  const m = src.match(/el\.style\.cssText\s*=\s*\n?\s*'([^']+)'/);
  if (!m) throw new Error('nao achei `el.style.cssText` em ' + relativo);
  return m[1];
}

async function baixarMaplibre() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const arquivo of ['maplibre-gl.js', 'maplibre-gl.css']) {
    const destino = path.join(CACHE, arquivo);
    if (fs.existsSync(destino)) continue;
    const res = await fetch(
      'https://unpkg.com/maplibre-gl@' + MAPLIBRE_VERSAO + '/dist/' + arquivo,
    );
    if (!res.ok) throw new Error('falha ao baixar ' + arquivo + ': ' + res.status);
    fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
  }
}

function paginaDeTeste(css) {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<link href="maplibre-gl.css" rel="stylesheet"><script src="maplibre-gl.js"><\/script>',
    '<style>html,body{margin:0;padding:0}#map{position:absolute;inset:0}</style></head>',
    '<body><div id="map"></div><script>',
    "const A={version:8,sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#123'}}]};",
    "const B={version:8,sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#321'}}]};",
    "const map=new maplibregl.Map({container:'map',style:A,center:[-43.1715,-22.9100],zoom:15,attributionControl:false});",
    'const CSS=' + JSON.stringify(css) + ';',
    '// 8 veiculos espalhados pelo Centro do Rio - o defeito so aparece do 2o em diante.',
    "const PONTOS=[['A',-43.17153,-22.91005],['B',-43.17300,-22.91100],['C',-43.17000,-22.90900],",
    "['D',-43.17450,-22.91200],['E',-43.16900,-22.90800],['F',-43.17600,-22.91300],",
    "['G',-43.16800,-22.90700],['H',-43.17250,-22.90950]];",
    "function criarEl(){const el=document.createElement('div');el.className='vehicle-marker-container';",
    'el.style.cssText=CSS;el.innerHTML=\'<div style="width:54px;height:54px"></div>\';return el;}',
    'const markers=new Map();',
    'window.criarTodos=()=>{PONTOS.forEach(([id,lng,lat])=>{',
    'markers.set(id,new maplibregl.Marker({element:criarEl()}).setLngLat([lng,lat]).addTo(map));});return true;};',
    'window.medir=()=>PONTOS.map(([id,lng,lat])=>{',
    'const e=map.project([lng,lat]);const r=markers.get(id).getElement().getBoundingClientRect();',
    'const x=r.left+r.width/2,y=r.top+r.height/2;',
    'const mPorPx=156543.03392*Math.cos(lat*Math.PI/180)/Math.pow(2,map.getZoom());',
    'const erroPx=Math.hypot(x-e.x,y-e.y);',
    'return{id,erroPx:Math.round(erroPx),erroMetros:Math.round(erroPx*mPorPx),',
    "temClasse:markers.get(id).getElement().classList.contains('maplibregl-marker')};});",
    "window.trocarStyle=()=>new Promise(r=>{map.once('styledata',()=>setTimeout(()=>r(true),150));map.setStyle(B);});",
    '// redesenha o conteudo visual sem trocar o no que o MapLibre controla',
    'window.redesenhar=()=>{markers.forEach(m=>{',
    'm.getElement().innerHTML=\'<div style="width:54px;height:54px;background:#0f0"></div>\';});return true;};',
    '// Marcar varios: cada pino ganha a etiqueta numerada que amarra o pino a',
    '// linha do painel de marcados. Ela pendura ABAIXO do icone com',
    '// position:absolute + top:100%. Se um dia entrar no fluxo, empurra o',
    '// proprio marcador pra fora da coordenada - e este teste cai.',
    'window.marcarTodos=()=>{let n=0;markers.forEach(m=>{n++;',
    'const el=m.getElement();',
    "const et=document.createElement('div');",
    "et.style.cssText='position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:4px;padding:4px 9px;background:#0f172a;border:1px solid #10b981;border-radius:6px;white-space:nowrap;font-size:11px;line-height:1.35;z-index:9;pointer-events:none;';",
    "et.textContent=n+' ABC1D23';",
    'el.appendChild(et);});return true;};',
    "map.on('load',()=>{window.pronto=true});",
    '<\/script></body></html>',
  ].join('\n');
}

(async () => {
  if (!CHROME) {
    console.error('Chrome nao encontrado - instale o Chrome para rodar este teste.');
    process.exit(2);
  }
  await baixarMaplibre();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--allow-file-access-from-files',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });

  let falhou = false;
  for (const [nomeMapa, relativo] of FONTES) {
    const css = cssDoCodigo(relativo);
    console.log('\n########## ' + nomeMapa + ' (' + relativo + ')');
    console.log('cssText do marcador:\n  ' + css + '\n');
    const arquivo = path.join(CACHE, 'teste-' + nomeMapa.replace(/\W+/g, '-') + '.html');
    fs.writeFileSync(arquivo, paginaDeTeste(css));

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url.pathToFileURL(arquivo).href);
    await page.waitForFunction('window.pronto === true', { timeout: 30000 });

    const etapas = [];
    await page.evaluate('window.criarTodos()');
    etapas.push(['8 marcadores recem-criados', await page.evaluate('window.medir()')]);
    await page.evaluate('window.trocarStyle()');
    etapas.push(['depois de trocar o basemap', await page.evaluate('window.medir()')]);
    await page.evaluate('window.redesenhar()');
    etapas.push(['depois de redesenhar o icone', await page.evaluate('window.medir()')]);
    await page.evaluate('window.marcarTodos()');
    etapas.push([
      'com os 8 marcados e etiqueta numerada',
      await page.evaluate('window.medir()'),
    ]);
    await page.close();

    for (const [nome, medidas] of etapas) {
      console.log('-- ' + nome);
      console.table(medidas);
      for (const m of medidas) {
        if (m.erroPx > TOLERANCIA_PX || !m.temClasse) {
          falhou = true;
          console.error(
            '  x [' + nomeMapa + '] ' + m.id + ': erro de ' + m.erroPx +
              ' px (' + m.erroMetros + ' m)' +
              (m.temClasse ? '' : ' - perdeu a classe maplibregl-marker'),
          );
        }
      }
    }
  }
  await browser.close();

  if (falhou) {
    console.error(
      '\nFALHOU: marcador fora da coordenada. O mapa esta mentindo a posicao do veiculo.',
    );
    process.exit(1);
  }
  console.log(
    '\nOK: todos os marcadores dentro de ' + TOLERANCIA_PX + ' px da coordenada, em todas as etapas.',
  );
})();
