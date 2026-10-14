// Smoke da homologação efêmera do CI: só Node 22 (fetch + crypto), sem deps.
//
// Uso: node smoke.mjs --modo legado|flags --saida <arquivo.json>
// Env: API_URL, HOMOLOG_FIXTURE (escrito pelo semear-frota.mjs),
//      JWT_ASSOCIATE_SECRET (segredo DE TESTE gerado no job),
//      STOCK_MAP_CACHE_MS (só para o limite de idade no modo flags).
//
// Sai com código 1 se qualquer verificação falhar.

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    modo: { type: 'string', default: 'legado' },
    saida: { type: 'string', default: 'smoke.json' },
  },
});
const FLAGS = args.modo === 'flags';
const API = (process.env.API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '');
const SEED_EMAIL = process.env.SEED_EMAIL ?? 'admin@rastreamento21go.com.br';
const SEED_SENHA = process.env.SEED_PASSWORD ?? 'admin123';
const CACHE_MS = Number(process.env.STOCK_MAP_CACHE_MS ?? 0) || 0;
const fx = JSON.parse(readFileSync(process.env.HOMOLOG_FIXTURE, 'utf8'));

const checks = [];
const observacoes = [];
const naoCoberto = [
  'Login real do associado (/app/auth/login): depende do SGA Hinova ao vivo. O token do associado é assinado pelo próprio teste com o JWT_ASSOCIATE_SECRET de teste.',
  'Posições reais: devices sintéticos não têm posição; /traccar/positions devolve [] e o geocode do mapa do estoque não é exercitado.',
  'WebSocket (Socket.io) e crons: fora do escopo do smoke HTTP.',
];

function check(nome, ok, detalhe) {
  checks.push({ nome, ok: Boolean(ok), detalhe });
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${nome}${detalhe === undefined ? '' : ` ${JSON.stringify(detalhe)}`}`);
}

function observar(nome, detalhe, aviso = false) {
  observacoes.push({ nome, detalhe });
  console.log(`${aviso ? '::warning::' : 'OBS  '} ${nome} ${JSON.stringify(detalhe)}`);
}

async function req(metodo, rota, { token, corpo, headers } = {}) {
  const inicio = performance.now();
  const res = await fetch(`${API}${rota}`, {
    method: metodo,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(corpo ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await res.text();
  const recebidoEm = Date.now();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, headers: res.headers, ms: Math.round(performance.now() - inicio), recebidoEm };
}

/** O TransformInterceptor envelopa tudo em `{ data }`. */
const dados = (r) => (r.json && typeof r.json === 'object' && 'data' in r.json ? r.json.data : r.json);

async function login(email, senha) {
  const r = await req('POST', '/auth/login', { corpo: { email, password: senha } });
  const token = dados(r)?.accessToken;
  check(`login ${email}`, (r.status === 200 || r.status === 201) && token, { status: r.status });
  if (!token) throw new Error(`Login de ${email} falhou (${r.status})`);
  return token;
}

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/** Token do app do associado, com o mesmo formato do AssociateAuthService. */
function tokenDoAssociado(a) {
  const segredo = process.env.JWT_ASSOCIATE_SECRET;
  if (!segredo) throw new Error('JWT_ASSOCIATE_SECRET ausente');
  const agora = Math.floor(Date.now() / 1000);
  const corpo = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: a.id,
    type: 'associate',
    tenantId: a.tenantId,
    name: a.nome,
    iat: agora,
    exp: agora + 600,
  })}`;
  return `${corpo}.${createHmac('sha256', segredo).update(corpo).digest('base64url')}`;
}

async function main() {
  const sufixo = `${args.modo}-${Date.now()}`;
  const senha = `homolog-${randomBytes(6).toString('hex')}`;

  const h = await req('GET', '/health');
  check('health 200 com banco e Traccar ok', h.status === 200 && dados(h)?.ok === true, {
    status: h.status,
    checks: dados(h)?.checks,
  });

  const anon = await req('GET', '/stock/map');
  check('stock/map sem token = 401', anon.status === 401, { status: anon.status });

  const admin = await login(SEED_EMAIL, SEED_SENHA);

  const registrar = async (role, tenantId, rotulo) => {
    const email = `${rotulo}-${sufixo}@homolog.example.com`;
    const r = await req('POST', '/auth/register', {
      token: admin,
      corpo: { email, password: senha, name: `Homolog ${rotulo}`, role, tenantId },
    });
    check(`register ${rotulo} (${role}) = 201`, r.status === 201, {
      status: r.status,
      ...(r.status === 201 ? {} : { corpo: r.json }),
    });
    return login(email, senha);
  };
  const viewer = await registrar('VIEWER', fx.tenantA.id, 'viewer');
  const operator = await registrar('OPERATOR', fx.tenantA.id, 'operator');
  const client = await registrar('CLIENT', fx.tenantA.id, 'client');
  const adminB = await registrar('ADMIN', fx.tenantB.id, 'admin-b');

  // --- Mapa do estoque: 3 chamadas seguidas ---
  const mapas = [];
  for (let i = 0; i < 3; i++) mapas.push(await req('GET', '/stock/map', { token: admin }));
  check('stock/map 200 nas 3 chamadas', mapas.every((r) => r.status === 200), {
    status: mapas.map((r) => r.status),
    ms: mapas.map((r) => r.ms),
  });
  const mapa0 = dados(mapas[0]);
  check('stock/map traz todo o estoque do tenant A', mapa0?.pontos?.length === fx.tenantA.estoque, {
    recebidos: mapa0?.pontos?.length,
    esperado: fx.tenantA.estoque,
  });
  check('stock/map com Traccar disponível', mapa0?.indisponivel === false, { indisponivel: mapa0?.indisponivel });
  const gerados = mapas.map((r) => dados(r)?.geradoEm);
  const idades = mapas.map((r, i) => r.recebidoEm - Date.parse(gerados[i]));
  if (FLAGS) {
    check('flags: stock/map reaproveita a montagem (geradoEm repetido em 3 chamadas)', new Set(gerados).size < 3, { gerados });
    check(`flags: idade do stock/map ≤ STOCK_MAP_CACHE_MS (${CACHE_MS}) + 5 s`, Math.max(...idades) <= CACHE_MS + 5000, { idadesMs: idades });
  } else {
    observar('legado: geradoEm das 3 chamadas', { gerados, idadesMs: idades });
  }

  // --- Frota do painel com ETag ---
  const idsB = new Set(fx.tenantB.deviceIds);
  for (const rota of ['/traccar/devices', '/traccar/positions']) {
    const r1 = await req('GET', rota, { token: admin });
    const lista = dados(r1);
    check(`${rota} 200`, r1.status === 200 && Array.isArray(lista), { status: r1.status, ms: r1.ms });
    if (rota === '/traccar/devices') {
      check('/traccar/devices traz só os devices dos veículos do tenant A', lista?.length === fx.tenantA.veiculosComDevice && !lista.some((d) => idsB.has(d.id)), {
        recebidos: lista?.length,
        esperado: fx.tenantA.veiculosComDevice,
      });
    } else {
      observar('/traccar/positions (devices sintéticos sem posição)', { recebidos: lista?.length });
    }
    const etag = r1.headers.get('etag');
    const r2 = etag ? await req('GET', rota, { token: admin, headers: { 'if-none-match': etag } }) : null;
    if (FLAGS) {
      check(`flags: ${rota} com If-None-Match = 304`, Boolean(etag) && r2?.status === 304, { etag, status: r2?.status });
    } else {
      observar(`legado: ${rota} com If-None-Match`, { etag, status: r2?.status });
    }
  }

  // --- Autorização: rota OPERATOR+ que passa pelo guard sem efeito colateral ---
  // POST /stock/signal-batch com um UUID que não existe: o RolesGuard decide
  // antes da validação; quem passa recebe [] (nenhum item encontrado).
  const lote = { stockItemIds: [randomUUID()] };
  const rv = await req('POST', '/stock/signal-batch', { token: viewer, corpo: lote });
  check('VIEWER em rota OPERATOR+ (POST /stock/signal-batch) = 403', rv.status === 403, { status: rv.status });
  const ro = await req('POST', '/stock/signal-batch', { token: operator, corpo: lote });
  check('OPERATOR em POST /stock/signal-batch = 201 com []', ro.status === 201 && Array.isArray(dados(ro)) && dados(ro).length === 0, {
    status: ro.status,
  });

  // --- Isolamento entre tenants (B consultado depois de A ter aquecido o cache) ---
  const mb = await req('GET', '/stock/map', { token: adminB });
  const pontosB = dados(mb)?.pontos;
  check('tenant B: stock/map traz só o estoque de B', mb.status === 200 && pontosB?.length === fx.tenantB.estoque && pontosB.every((p) => p.imei.startsWith(fx.tenantB.prefixoImei)), {
    status: mb.status,
    recebidos: pontosB?.length,
    esperado: fx.tenantB.estoque,
  });
  const db = await req('GET', '/traccar/devices', { token: adminB });
  const devB = dados(db);
  check('tenant B: /traccar/devices traz só os devices de B', db.status === 200 && devB?.length === idsB.size && devB.every((d) => idsB.has(d.id)), {
    status: db.status,
    recebidos: devB?.length,
  });
  const cruzado = await req('POST', '/stock/signal-batch', { token: operator, corpo: { stockItemIds: [fx.tenantB.stockItemId] } });
  check('OPERATOR do A não enxerga item de estoque do B', cruzado.status === 201 && Array.isArray(dados(cruzado)) && dados(cruzado).length === 0, {
    status: cruzado.status,
  });
  const comHeader = await req('GET', '/stock/map', { token: operator, headers: { 'x-tenant-id': fx.tenantB.id } });
  check('x-tenant-id de outro tenant é ignorado para OPERATOR', comHeader.status === 200 && dados(comHeader)?.pontos?.length === fx.tenantA.estoque, {
    status: comHeader.status,
    recebidos: dados(comHeader)?.pontos?.length,
  });
  const mapaDeNovo = await req('GET', '/stock/map', { token: admin });
  check('tenant A continua com o próprio estoque depois de B', dados(mapaDeNovo)?.pontos?.length === fx.tenantA.estoque, {
    recebidos: dados(mapaDeNovo)?.pontos?.length,
  });

  // --- App do associado (mundo separado do painel) ---
  for (const a of [fx.associadoA, fx.associadoB]) {
    const r = await req('GET', '/app/vehicles', { token: tokenDoAssociado(a) });
    const placas = (dados(r) ?? []).map((v) => v.plate).sort();
    check(`/app/vehicles do associado ${a.nome} traz só os veículos dele`, r.status === 200 && JSON.stringify(placas) === JSON.stringify([...a.placas].sort()), {
      status: r.status,
      placas,
    });
  }
  const rc = await req('GET', '/app/vehicles', { token: client });
  check('CLIENT do painel em /app/vehicles = 401 (token do painel não vale no app)', rc.status === 401, { status: rc.status });
  const ra = await req('GET', '/stock/map', { token: tokenDoAssociado(fx.associadoA) });
  check('token do associado em /stock/map = 401 (não vale no painel)', ra.status === 401, { status: ra.status });

  // Comportamento pré-existente, registrado sem reprovar: as rotas abaixo não
  // têm RolesGuard, então o perfil CLIENT do painel chega nelas.
  for (const rota of ['/stock/map', '/traccar/devices']) {
    const r = await req('GET', rota, { token: client });
    observar(`CLIENT do painel em GET ${rota}`, { status: r.status }, r.status === 200);
  }
}

let erroFatal = null;
try {
  await main();
} catch (erro) {
  erroFatal = erro instanceof Error ? erro.message : String(erro);
  check('smoke executou até o fim', false, { erro: erroFatal });
}

const resultado = {
  modo: args.modo,
  nivel: '(3) homologação completa — dados sintéticos',
  flags: {
    STOCK_MAP_CACHE_MS: process.env.STOCK_MAP_CACHE_MS ?? null,
    FROTA_PAINEL_CACHE_MS: process.env.FROTA_PAINEL_CACHE_MS ?? null,
  },
  ok: checks.every((c) => c.ok),
  falhas: checks.filter((c) => !c.ok).map((c) => c.nome),
  checks,
  observacoes,
  naoCoberto,
};
writeFileSync(args.saida, JSON.stringify(resultado, null, 2));
console.log(`Smoke ${args.modo}: ${checks.length - resultado.falhas.length}/${checks.length} verificações ok`);
if (!resultado.ok) process.exit(1);
