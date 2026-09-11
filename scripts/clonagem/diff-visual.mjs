#!/usr/bin/env node
/**
 * Compara duas capturas de tela e devolve um número, não uma opinião.
 *
 * Adaptado de `scripts/visual-diff.mjs` da skill MIT
 * Jane-xiaoer/claude-skill-web-clone (lá roda em Playwright; aqui em
 * puppeteer-core, que o projeto já usa). A conta é feita no canvas do próprio
 * navegador — sem dependência nativa de imagem.
 *
 * Uso:
 *   node scripts/clonagem/diff-visual.mjs --origem <png> --nosso <png> \
 *     [--saida diff.json] [--imagem diff.png] [--tolerancia 0.08]
 *
 * Serve para responder "ficou igual?" quando as duas telas seguem o MESMO
 * tema. Comparar a tela da origem (tema claro, Bootstrap) com a nossa (tema
 * navy) sempre dará nota baixa e isso não quer dizer nada: aí o que vale é a
 * conferência de campo a campo do `inventario.json` do recon.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function args(argv) {
  const o = { origem: '', nosso: '', saida: 'diff-visual.json', imagem: '', tolerancia: 0.08 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--origem') o.origem = argv[++i];
    else if (a === '--nosso') o.nosso = argv[++i];
    else if (a === '--saida') o.saida = argv[++i];
    else if (a === '--imagem') o.imagem = argv[++i];
    else if (a === '--tolerancia') o.tolerancia = Number(argv[++i]);
    else throw new Error(`Argumento desconhecido: ${a}`);
  }
  return o;
}

const dataUrl = (arquivo) =>
  `data:image/${path.extname(arquivo).slice(1) || 'png'};base64,${fs.readFileSync(arquivo).toString('base64')}`;

/** A mesma escala de nota da skill de origem. */
function nota(proporcao, media) {
  if (proporcao <= 0.01 && media <= 0.01) return 5;
  if (proporcao <= 0.04 && media <= 0.025) return 4.5;
  if (proporcao <= 0.08 && media <= 0.05) return 4;
  if (proporcao <= 0.16 && media <= 0.08) return 3;
  if (proporcao <= 0.3 && media <= 0.14) return 2;
  return 1;
}

(async () => {
  const o = args(process.argv.slice(2));
  for (const campo of ['origem', 'nosso']) {
    if (!o[campo] || !fs.existsSync(o[campo])) {
      console.error(`Faltou --${campo} (arquivo PNG existente).`);
      process.exit(1);
    }
  }

  const navegador = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const pagina = await navegador.newPage();

  const r = await pagina.evaluate(
    async ({ a, b, tolerancia }) => {
      const carrega = (src) =>
        new Promise((ok, erro) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.onerror = () => erro(new Error('não consegui carregar a imagem'));
          img.src = src;
        });
      const [esq, dir] = await Promise.all([carrega(a), carrega(b)]);
      const w = Math.max(esq.naturalWidth, dir.naturalWidth);
      const h = Math.max(esq.naturalHeight, dir.naturalHeight);

      const pinta = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h);
      };
      const A = pinta(esq);
      const B = pinta(dir);

      const saida = document.createElement('canvas');
      saida.width = w;
      saida.height = h;
      const ctxD = saida.getContext('2d');
      const D = ctxD.createImageData(w, h);

      let diferentes = 0;
      let soma = 0;
      for (let i = 0; i < A.data.length; i += 4) {
        const d =
          (Math.abs(A.data[i] - B.data[i]) +
            Math.abs(A.data[i + 1] - B.data[i + 1]) +
            Math.abs(A.data[i + 2] - B.data[i + 2])) /
          3 /
          255;
        soma += d;
        const passou = d > tolerancia;
        if (passou) diferentes += 1;
        D.data[i] = passou ? 255 : A.data[i];
        D.data[i + 1] = passou ? 0 : A.data[i + 1];
        D.data[i + 2] = passou ? 0 : A.data[i + 2];
        D.data[i + 3] = 255;
      }
      ctxD.putImageData(D, 0, 0);
      const total = A.data.length / 4;
      return {
        largura: w,
        altura: h,
        proporcaoDiferente: diferentes / total,
        diferencaMedia: soma / total,
        imagem: saida.toDataURL('image/png'),
      };
    },
    { a: dataUrl(o.origem), b: dataUrl(o.nosso), tolerancia: o.tolerancia },
  );

  await navegador.close();

  const resultado = {
    origem: o.origem,
    nosso: o.nosso,
    largura: r.largura,
    altura: r.altura,
    proporcaoDiferente: Number(r.proporcaoDiferente.toFixed(4)),
    diferencaMedia: Number(r.diferencaMedia.toFixed(4)),
    nota: nota(r.proporcaoDiferente, r.diferencaMedia),
  };
  fs.writeFileSync(o.saida, JSON.stringify(resultado, null, 1), 'utf8');
  if (o.imagem) {
    fs.writeFileSync(o.imagem, Buffer.from(r.imagem.split(',')[1], 'base64'));
  }
  console.log(
    `nota ${resultado.nota}/5 — ${(resultado.proporcaoDiferente * 100).toFixed(1)}% dos pixels diferentes`,
  );
  console.log('relatório em', path.resolve(o.saida));
})();
