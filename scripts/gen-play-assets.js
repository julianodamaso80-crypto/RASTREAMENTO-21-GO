const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:/Users/damas/Documents/PROJETOS/21 GO/21 - RASTREAMENTO';
const OUT = path.join(ROOT, 'mobile/store/play');
fs.mkdirSync(OUT, { recursive: true });

const NAVY = '#293c82';
const ORANGE = '#f2911d';

(async () => {
  // 1) Ícone da loja 512x512, sem alfa (fundo navy)
  await sharp(path.join(ROOT, 'mobile/assets/images/icon.png'))
    .resize(512, 512, { fit: 'cover' })
    .flatten({ background: NAVY })
    .png()
    .toFile(path.join(OUT, 'icon-512.png'));

  // 2) Feature graphic 1024x500
  const logo = await sharp(path.join(ROOT, 'designer/logomarca sem fundo.png'))
    .resize({ height: 260, fit: 'inside' })
    .toBuffer();
  const logoMeta = await sharp(logo).metadata();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1f2d63"/>
        <stop offset="55%" stop-color="${NAVY}"/>
        <stop offset="100%" stop-color="#16204a"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="500" fill="url(#bg)"/>
    <circle cx="880" cy="80" r="220" fill="${ORANGE}" opacity="0.07"/>
    <circle cx="120" cy="470" r="180" fill="${ORANGE}" opacity="0.05"/>
    <text x="${100 + logoMeta.width + 56}" y="228" font-family="Segoe UI, Arial, sans-serif" font-size="76" font-weight="700" fill="#ffffff">21 Tracker</text>
    <text x="${100 + logoMeta.width + 56}" y="292" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="400" fill="#c9d2f0">Rastreamento em tempo real</text>
    <rect x="${100 + logoMeta.width + 58}" y="320" width="96" height="6" rx="3" fill="${ORANGE}"/>
  </svg>`;

  await sharp(Buffer.from(svg))
    .composite([{ input: logo, left: 100, top: Math.round((500 - 260) / 2) }])
    .flatten({ background: NAVY })
    .removeAlpha()
    .png()
    .toFile(path.join(OUT, 'feature-graphic-1024x500.png'));

  for (const f of fs.readdirSync(OUT)) {
    const m = await sharp(path.join(OUT, f)).metadata();
    console.log(f, m.width + 'x' + m.height, 'alpha=' + m.hasAlpha);
  }
})();
