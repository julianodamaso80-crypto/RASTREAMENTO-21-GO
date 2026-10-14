// Frota sintética da homologação efêmera do CI (nunca rodar contra produção).
//
// Traccar: 10.000 devices via POST /api/devices (Basic auth do admin de teste).
// Postgres: 7.000 Vehicle + 9.386 StockItem no tenant do seed (tenant A) e um
// tenant B pequeno para o teste de vazamento entre empresas, além de um
// associado em cada tenant para o app.
//
// Determinístico e idempotente: rodar de novo não duplica nada.
// Escreve as referências que o smoke precisa em $HOMOLOG_FIXTURE.
//
// Limitação conhecida: devices sintéticos não têm posição no Traccar, então
// /traccar/positions devolve [] e o mapa do estoque não passa pelo geocode.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

// `.prisma/client` não é especificador válido em ESM; o require do CommonJS
// resolve a partir de backend/node_modules, igual ao PrismaService.
const require = createRequire(import.meta.url);
const { PrismaClient } = require('.prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const env = (nome, padrao) => {
  const v = process.env[nome] ?? padrao;
  if (v === undefined || v === '') throw new Error(`Variável ${nome} ausente`);
  return v;
};

const TRACCAR_API = env('TRACCAR_API_URL', 'http://localhost:8082/api');
const TRACCAR_AUTH =
  'Basic ' +
  Buffer.from(
    `${env('TRACCAR_ADMIN_EMAIL')}:${env('TRACCAR_ADMIN_PASSWORD')}`,
  ).toString('base64');
const DATABASE_URL = env('DATABASE_URL');
const FIXTURE = env('HOMOLOG_FIXTURE');

const TOTAL_DEVICES = Number(env('HOMOLOG_DEVICES', '10000'));
const VEICULOS_A = Number(env('HOMOLOG_VEICULOS', '7000'));
const ESTOQUE_A = Number(env('HOMOLOG_ESTOQUE', '9386'));
const VEICULOS_B = 3;
const ESTOQUE_B = 5;
const CONCORRENCIA = 10;
const LOTE_DB = 1000;

const SLUG_A = '21-go-rastreamento'; // criado pelo prisma/seed.ts
const SLUG_B = 'homolog-tenant-b';
const PREFIXO_IMEI_A_SEM_DEVICE = '35';
const PREFIXO_IMEI_B = '99';

const pad = (n, t) => String(n).padStart(t, '0');
const uniqueIdDoDevice = (i) => `86${pad(i, 13)}`;

// Faixas de devices: [0, VEICULOS_A) → veículos A; os 3 últimos → veículos B;
// o meio → rastreadores do estoque A que já existem no Traccar.
const inicioB = TOTAL_DEVICES - VEICULOS_B;
if (inicioB <= VEICULOS_A) throw new Error('Devices insuficientes para as faixas');

async function traccar(metodo, rota, corpo) {
  const res = await fetch(`${TRACCAR_API}${rota}`, {
    method: metodo,
    headers: {
      authorization: TRACCAR_AUTH,
      accept: 'application/json',
      ...(corpo ? { 'content-type': 'application/json' } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await res.text();
  if (!res.ok) {
    throw new Error(`Traccar ${metodo} ${rota} → ${res.status}: ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : null;
}

async function semearDevices() {
  const existentes = await traccar('GET', '/devices?all=true');
  const porUniqueId = new Map(existentes.map((d) => [d.uniqueId, d.id]));
  const faltando = [];
  for (let i = 0; i < TOTAL_DEVICES; i++) {
    if (!porUniqueId.has(uniqueIdDoDevice(i))) faltando.push(i);
  }
  console.log(`Traccar: ${porUniqueId.size} devices já existem, ${faltando.length} a criar`);

  const inicio = Date.now();
  let proximo = 0;
  let criados = 0;
  const trabalhador = async () => {
    while (proximo < faltando.length) {
      const i = faltando[proximo++];
      const uniqueId = uniqueIdDoDevice(i);
      const d = await traccar('POST', '/devices', {
        name: `HML-${pad(i, 5)}`,
        uniqueId,
      });
      porUniqueId.set(uniqueId, d.id);
      criados++;
      if (criados % 1000 === 0) {
        console.log(`  ${criados}/${faltando.length} devices (${Math.round((Date.now() - inicio) / 1000)} s)`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCORRENCIA }, trabalhador));
  console.log(`Traccar: ${criados} devices criados em ${Math.round((Date.now() - inicio) / 1000)} s`);

  const ids = [];
  for (let i = 0; i < TOTAL_DEVICES; i++) ids.push(porUniqueId.get(uniqueIdDoDevice(i)));
  return ids;
}

async function emLotes(linhas, gravar) {
  let total = 0;
  for (let i = 0; i < linhas.length; i += LOTE_DB) {
    const r = await gravar(linhas.slice(i, i + LOTE_DB));
    total += r.count;
  }
  return total;
}

async function associado(prisma, tenantId, cpf, nome) {
  const achado = await prisma.associate.findFirst({
    where: { tenantId, cpf, deletedAt: null },
  });
  if (achado) return achado;
  return prisma.associate.create({ data: { tenantId, cpf, name: nome } });
}

async function main() {
  const deviceIds = await semearDevices();

  const pool = new Pool({ connectionString: DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const tenantA = await prisma.tenant.findUnique({ where: { slug: SLUG_A } });
    if (!tenantA) throw new Error(`Tenant ${SLUG_A} não existe: o seed rodou?`);
    const tenantB = await prisma.tenant.upsert({
      where: { slug: SLUG_B },
      update: {},
      create: { name: 'Homologação Tenant B', slug: SLUG_B },
    });

    const assocA = await associado(prisma, tenantA.id, '00000000191', 'Associado Homolog A');
    const assocB = await associado(prisma, tenantB.id, '00000000272', 'Associado Homolog B');

    // Veículos: os 2 primeiros do A e o primeiro do B pertencem aos associados.
    const veiculosA = [];
    for (let i = 0; i < VEICULOS_A; i++) {
      veiculosA.push({
        plate: `HMA${pad(i, 5)}`,
        uniqueId: uniqueIdDoDevice(i),
        traccarDeviceId: deviceIds[i],
        tenantId: tenantA.id,
        associateId: i < 2 ? assocA.id : null,
      });
    }
    const veiculosB = [];
    for (let k = 0; k < VEICULOS_B; k++) {
      const i = inicioB + k;
      veiculosB.push({
        plate: `HMB${pad(k, 5)}`,
        uniqueId: uniqueIdDoDevice(i),
        traccarDeviceId: deviceIds[i],
        tenantId: tenantB.id,
        associateId: k === 0 ? assocB.id : null,
      });
    }
    const novosVeiculos = await emLotes([...veiculosA, ...veiculosB], (data) =>
      prisma.vehicle.createMany({ data, skipDuplicates: true }),
    );

    // Estoque A: primeiro os devices do meio (já no Traccar), o resto como
    // rastreador de prateleira que nunca falou com o servidor.
    const comDevice = inicioB - VEICULOS_A;
    const estoqueA = [];
    for (let j = 0; j < ESTOQUE_A; j++) {
      const temDevice = j < comDevice;
      estoqueA.push({
        imei: temDevice
          ? uniqueIdDoDevice(VEICULOS_A + j)
          : `${PREFIXO_IMEI_A_SEM_DEVICE}${pad(j, 13)}`,
        traccarDeviceId: temDevice ? deviceIds[VEICULOS_A + j] : null,
        tenantId: tenantA.id,
        kind: 'RASTREADOR',
        status: 'ATIVO',
        operator: j % 2 === 0 ? 'VIVO' : 'CLARO',
      });
    }
    const estoqueB = [];
    for (let k = 0; k < ESTOQUE_B; k++) {
      estoqueB.push({
        imei: `${PREFIXO_IMEI_B}${pad(k, 13)}`,
        tenantId: tenantB.id,
        kind: 'RASTREADOR',
        status: 'ATIVO',
      });
    }
    const novosItens = await emLotes([...estoqueA, ...estoqueB], (data) =>
      prisma.stockItem.createMany({ data, skipDuplicates: true }),
    );

    const contar = (tenantId, extra = {}) =>
      prisma.stockItem.count({
        where: { tenantId, deletedAt: null, associatedAt: null, kind: 'RASTREADOR', ...extra },
      });
    const itemB = await prisma.stockItem.findFirst({
      where: { tenantId: tenantB.id, imei: estoqueB[0].imei },
      select: { id: true },
    });

    const fixture = {
      tenantA: {
        id: tenantA.id,
        estoque: await contar(tenantA.id),
        veiculosComDevice: await prisma.vehicle.count({
          where: { tenantId: tenantA.id, deletedAt: null, traccarDeviceId: { not: null } },
        }),
      },
      tenantB: {
        id: tenantB.id,
        estoque: await contar(tenantB.id),
        prefixoImei: PREFIXO_IMEI_B,
        stockItemId: itemB.id,
        deviceIds: veiculosB.map((v) => v.traccarDeviceId),
      },
      associadoA: {
        id: assocA.id,
        tenantId: tenantA.id,
        nome: assocA.name,
        placas: veiculosA.filter((v) => v.associateId).map((v) => v.plate),
      },
      associadoB: {
        id: assocB.id,
        tenantId: tenantB.id,
        nome: assocB.name,
        placas: veiculosB.filter((v) => v.associateId).map((v) => v.plate),
      },
      traccarDevices: deviceIds.length,
    };
    writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2));
    console.log(
      `Postgres: ${novosVeiculos} veículos e ${novosItens} itens de estoque novos. ` +
        `Tenant A: ${fixture.tenantA.veiculosComDevice} veículos, ${fixture.tenantA.estoque} no estoque. ` +
        `Tenant B: ${fixture.tenantB.deviceIds.length} veículos, ${fixture.tenantB.estoque} no estoque.`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((erro) => {
  console.error('Falha ao semear a frota sintética:', erro);
  process.exit(1);
});
