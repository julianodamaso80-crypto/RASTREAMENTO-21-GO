// Carga sintética da homologação efêmera do CI: só Node 22 (fetch), sem deps.
//
// Uso: node carga.mjs --modo legado|flags --saida <arquivo.json> [--duracao 60]
// Env: API_URL, HOMOLOG_FIXTURE, CARGA_ERRO_MAX (fração, padrão 0.01).
//
// Chegadas em malha aberta (não espera a resposta para disparar a próxima):
// 6 req/s em /stock/map + 2 req/s em /traccar/positions + 1 req/s em /health.
// As rotas logadas se dividem entre 6 operadores criados aqui: o throttler
// limita 300 req/min por usuário e um usuário só levaria 429 (480 req/min).
//
// Sai com código 1 se alguma rota passar de CARGA_ERRO_MAX em erros.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    modo: { type: 'string', default: 'legado' },
    saida: { type: 'string', default: 'carga.json' },
    duracao: { type: 'string', default: '60' },
  },
});
const API = (process.env.API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '');
const SEED_EMAIL = process.env.SEED_EMAIL ?? 'admin@rastreamento21go.com.br';
const SEED_SENHA = process.env.SEED_PASSWORD ?? 'admin123';
const DURACAO_S = Number(args.duracao);
const ERRO_MAX = Number(process.env.CARGA_ERRO_MAX ?? '0.01');
const OPERADORES = 6;
const TIMEOUT_MS = 30_000;
const fx = JSON.parse(readFileSync(process.env.HOMOLOG_FIXTURE, 'utf8'));

const ROTAS = [
  { rota: '/stock/map', rps: 6, logada: true },
  { rota: '/traccar/positions', rps: 2, logada: true },
  { rota: '/health', rps: 1, logada: false },
];

async function postar(rota, corpo, token) {
  const res = await fetch(`${API}${rota}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`POST ${rota} → ${res.status}: ${JSON.stringify(json)}`);
  return json?.data ?? json;
}

const login = async (email, senha) => (await postar('/auth/login', { email, password: senha })).accessToken;

function percentil(ordenados, q) {
  if (ordenados.length === 0) return null;
  return ordenados[Math.min(ordenados.length - 1, Math.ceil(q * ordenados.length) - 1)];
}

async function disparar(alvo, token, amostras, geradosEm) {
  const inicio = performance.now();
  const amostra = { status: 0, ms: 0, erro: null };
  try {
    const res = await fetch(`${API}${alvo.rota}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = await res.text();
    amostra.status = res.status;
    amostra.ms = Math.round(performance.now() - inicio);
    if (res.status !== 200) amostra.erro = `HTTP ${res.status}`;
    if (alvo.rota === '/stock/map' && res.status === 200) {
      const geradoEm = JSON.parse(texto)?.data?.geradoEm;
      if (geradoEm) {
        geradosEm.add(geradoEm);
        amostra.idadeMs = Date.now() - Date.parse(geradoEm);
      }
    }
  } catch (erro) {
    amostra.ms = Math.round(performance.now() - inicio);
    amostra.erro = erro instanceof Error ? erro.name : String(erro);
  }
  amostras.push(amostra);
}

function resumir(alvo, amostras, geradosEm) {
  const ms = amostras.map((a) => a.ms).sort((a, b) => a - b);
  const erros = amostras.filter((a) => a.erro);
  const status = {};
  for (const a of amostras) status[a.status || a.erro] = (status[a.status || a.erro] ?? 0) + 1;
  const r = {
    alvoRps: alvo.rps,
    enviadas: amostras.length,
    erros: erros.length,
    taxaErro: amostras.length ? Number((erros.length / amostras.length).toFixed(4)) : 0,
    status,
    p50Ms: percentil(ms, 0.5),
    p95Ms: percentil(ms, 0.95),
    p99Ms: percentil(ms, 0.99),
    maxMs: ms.at(-1) ?? null,
  };
  if (alvo.rota === '/stock/map') {
    const idades = amostras.filter((a) => a.idadeMs !== undefined).map((a) => a.idadeMs).sort((a, b) => a - b);
    r.montagens = geradosEm.size;
    r.idadeP95Ms = percentil(idades, 0.95);
    r.idadeMaxMs = idades.at(-1) ?? null;
  }
  return r;
}

async function main() {
  const admin = await login(SEED_EMAIL, SEED_SENHA);
  const senha = `carga-${randomBytes(6).toString('hex')}`;
  const tokens = [];
  for (let i = 0; i < OPERADORES; i++) {
    const email = `carga-${args.modo}-${Date.now()}-${i}@homolog.example.com`;
    await postar('/auth/register', { email, password: senha, name: `Carga ${i}`, role: 'OPERATOR', tenantId: fx.tenantA.id }, admin);
    tokens.push(await login(email, senha));
  }

  console.log(`Carga ${args.modo}: ${DURACAO_S} s, ${ROTAS.map((r) => `${r.rps}/s ${r.rota}`).join(' + ')}`);
  const estado = ROTAS.map((alvo) => ({ alvo, amostras: [], geradosEm: new Set() }));
  const emVoo = [];
  let vez = 0;
  const timers = estado.map((e) =>
    setInterval(() => {
      const token = e.alvo.logada ? tokens[vez++ % tokens.length] : null;
      emVoo.push(disparar(e.alvo, token, e.amostras, e.geradosEm));
    }, 1000 / e.alvo.rps),
  );
  await new Promise((fim) => setTimeout(fim, DURACAO_S * 1000));
  timers.forEach(clearInterval);
  await Promise.allSettled(emVoo);

  const rotas = {};
  for (const e of estado) rotas[e.alvo.rota] = resumir(e.alvo, e.amostras, e.geradosEm);
  return rotas;
}

let rotas = {};
let erroFatal = null;
try {
  rotas = await main();
} catch (erro) {
  erroFatal = erro instanceof Error ? erro.message : String(erro);
}

const acimaDoLimite = Object.entries(rotas)
  .filter(([, r]) => r.taxaErro > ERRO_MAX)
  .map(([rota]) => rota);
const resultado = {
  modo: args.modo,
  nivel: '(3) homologação completa — dados sintéticos, runner do GitHub Actions',
  flags: {
    STOCK_MAP_CACHE_MS: process.env.STOCK_MAP_CACHE_MS ?? null,
    FROTA_PAINEL_CACHE_MS: process.env.FROTA_PAINEL_CACHE_MS ?? null,
  },
  duracaoS: DURACAO_S,
  operadores: OPERADORES,
  erroMax: ERRO_MAX,
  ok: !erroFatal && acimaDoLimite.length === 0,
  erroFatal,
  acimaDoLimite,
  rotas,
};
writeFileSync(args.saida, JSON.stringify(resultado, null, 2));
console.log(JSON.stringify(rotas, null, 2));
if (!resultado.ok) {
  console.error(`Carga ${args.modo} reprovada: ${erroFatal ?? `erros acima de ${ERRO_MAX * 100}% em ${acimaDoLimite.join(', ')}`}`);
  process.exit(1);
}
