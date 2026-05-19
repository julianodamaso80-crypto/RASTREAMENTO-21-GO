/* eslint-disable */
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCacheEnabled(false);

  // Captura console pra reportar erros não relacionados
  const msgs = [];
  page.on('console', (m) => msgs.push({ t: m.type(), x: m.text() }));
  page.on('pageerror', (e) => msgs.push({ t: 'pageerror', x: e.message }));

  // 1) Login
  await page.goto('https://trackgo.site/login', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.type('input[type="email"]', 'admin@rastreamento21go.com.br');
  await page.type('input[type="password"]', 'admin123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);

  // 2) Dashboard — paleta + favicon
  if (!page.url().endsWith('/dashboard')) {
    await page.goto('https://trackgo.site/dashboard', { waitUntil: 'networkidle0' });
  }
  await new Promise((r) => setTimeout(r, 4000));
  await page.screenshot({ path: 'brand-dashboard.png' });

  const dashChecks = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    const header = document.querySelector('header');
    const bodyFont = getComputedStyle(document.body).fontFamily;
    const sidebarBg = aside ? getComputedStyle(aside).backgroundColor : null;
    const headerBg = header ? getComputedStyle(header).backgroundColor : null;
    const favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]')?.getAttribute('href') ?? null;
    const activeIndicator = document.querySelector('aside a[href="/dashboard"] span[aria-hidden="true"]');
    const indicatorBg = activeIndicator ? getComputedStyle(activeIndicator).backgroundColor : null;
    return { bodyFont, sidebarBg, headerBg, favicon, indicatorBg };
  });
  console.log('\n=== DASHBOARD ===');
  console.log(JSON.stringify(dashChecks, null, 2));

  // 3) Mapa — confirmar SEM placas mock
  await page.goto('https://trackgo.site/mapa', { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));
  await page.screenshot({ path: 'brand-mapa.png' });

  const mapaChecks = await page.evaluate(() => {
    const text = document.body.innerText;
    const mockPlates = ['ABC1D23', 'DEF2G45', 'GHI3J67', 'JKL4M89', 'MNO5P01', 'PQR6S23', 'STU7V45', 'VWX8Y67', 'YZA9B01', 'BCD1E23'];
    return {
      mockPlatesFound: mockPlates.filter((p) => text.includes(p)),
      hasToast: text.includes('Backend indisponível') || text.includes('Falha ao carregar'),
    };
  });
  console.log('\n=== MAPA ===');
  console.log(JSON.stringify(mapaChecks, null, 2));

  // 4) Favicon respondendo via HTTP
  const faviconResp = await page.goto('https://trackgo.site/icon.png', { waitUntil: 'networkidle0' });
  console.log('\n=== FAVICON ===');
  console.log('GET /icon.png:', faviconResp.status(), faviconResp.headers()['content-type']);

  console.log('\n=== CONSOLE (filtrado: erros reais) ===');
  const realErrors = msgs.filter((m) => (m.t === 'error' || m.t === 'pageerror') && !/cloudflareinsights/i.test(m.x));
  console.log('erros relevantes:', realErrors.length);
  realErrors.slice(0, 5).forEach((m) => console.log('  -', m.t, ':', m.x.slice(0, 200)));

  await browser.close();
})().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(2);
});
