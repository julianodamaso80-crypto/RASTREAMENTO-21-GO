/* eslint-disable */
/**
 * Cria (ou completa) a EMPRESA DE DEMONSTRAÇÃO do painel do Track.
 *
 * Tudo aqui é inventado: nomes, CPFs (com dígito verificador errado de
 * propósito, para nunca coincidir com uma pessoa real), placas, IMEIs
 * (prefixo DEMOTRK) e chips. Os 12 rastreadores existem no Traccar só para o
 * mapa ter posição: quem manda a posição é o simulador /opt/demo-gps/frota-demo.py.
 *
 * Roda DENTRO do container do backend (tem o Prisma, o bcrypt e as envs):
 *   docker cp criar-empresa-demo.js <cid>:/app/criar-empresa-demo.js
 *   docker exec -e DEMO_SENHA=... <cid> node /app/criar-empresa-demo.js           (ensaio)
 *   docker exec -e DEMO_SENHA=... <cid> node /app/criar-empresa-demo.js --aplicar
 *
 * Idempotente: pode rodar de novo, não duplica nada.
 */
const { PrismaClient } = require('.prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { veiculoDoSgaSimulado } = require('./dist/src/modules/hinova/hinova-mock.service');

const APLICAR = process.argv.includes('--aplicar');
const SLUG = 'demonstracao';
const EMAIL = 'demo@trackgo.site';
const SENHA = process.env.DEMO_SENHA;
if (!SENHA || SENHA.length < 8) {
  console.error('Defina DEMO_SENHA (mínimo 8 caracteres).');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ASSOCIADOS = [
  'Bruno Tavares (Demo)', 'Camila Rocha (Demo)', 'Diego Martins (Demo)', 'Elaine Couto (Demo)',
  'Fábio Nunes (Demo)', 'Gabriela Lins (Demo)', 'Hugo Prado (Demo)', 'Isabela Moura (Demo)',
  'Jorge Antunes (Demo)', 'Karen Duarte (Demo)',
];
// [marca, modelo, cor, ano, tipo]
const VEICULOS = [
  ['Fiat', 'Strada', 'Branco', 2023, 'CAR'], ['VW', 'Polo', 'Prata', 2022, 'CAR'],
  ['Chevrolet', 'Onix', 'Preto', 2024, 'CAR'], ['Hyundai', 'HB20', 'Vermelho', 2021, 'CAR'],
  ['Toyota', 'Corolla', 'Cinza', 2023, 'CAR'], ['Honda', 'CG 160', 'Vermelha', 2024, 'MOTORCYCLE'],
  ['Fiat', 'Toro', 'Branco', 2022, 'CAR'], ['VW', 'T-Cross', 'Azul', 2024, 'CAR'],
  ['Chevrolet', 'Tracker', 'Branco', 2023, 'CAR'], ['Renault', 'Kwid', 'Laranja', 2022, 'CAR'],
  ['Jeep', 'Renegade', 'Verde', 2021, 'CAR'], ['Honda', 'Biz 125', 'Preta', 2023, 'MOTORCYCLE'],
];
// veículo i pertence a ASSOCIADOS[DONO[i]] — dois associados têm dois veículos
const DONO = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 4];
const imei = (n) => `DEMOTRK${String(n).padStart(8, '0')}`;
const iccid = (n) => `8955DEMO${String(n).padStart(11, '0')}`;
const dias = (n) => new Date(Date.now() - n * 86400000);

async function traccar() {
  const base = process.env.TRACCAR_API_URL;
  const corpo = new URLSearchParams({ email: process.env.TRACCAR_ADMIN_EMAIL, password: process.env.TRACCAR_ADMIN_PASSWORD });
  const r = await fetch(`${base}/session`, { method: 'POST', body: corpo, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!r.ok) throw new Error(`Traccar login ${r.status}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const h = { Cookie: cookie, 'Content-Type': 'application/json', Accept: 'application/json' };
  return {
    async garantirDevice(nome, uniqueId) {
      const busca = await (await fetch(`${base}/devices?uniqueId=${uniqueId}`, { headers: h })).json();
      const achado = Array.isArray(busca) ? busca.find((d) => d.uniqueId === uniqueId) : null;
      if (achado) return achado.id;
      if (!APLICAR) return -1;
      const c = await fetch(`${base}/devices`, { method: 'POST', headers: h, body: JSON.stringify({ name: nome, uniqueId }) });
      if (!c.ok) throw new Error(`Traccar createDevice ${uniqueId}: ${c.status} ${await c.text()}`);
      return (await c.json()).id;
    },
  };
}

async function main() {
  console.log(APLICAR ? '== APLICANDO ==' : '== ENSAIO (nada é gravado; use --aplicar) ==');
  const tx = APLICAR ? prisma : null;

  let tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant && APLICAR) {
    tenant = await prisma.tenant.create({ data: { name: 'Demonstração TrackGo', slug: SLUG, isDemo: true } });
  } else if (tenant && !tenant.isDemo && APLICAR) {
    tenant = await prisma.tenant.update({ where: { id: tenant.id }, data: { isDemo: true } });
  }
  console.log('tenant:', tenant ? `${tenant.id} isDemo=${tenant.isDemo}` : '(seria criado)');
  if (!APLICAR) {
    const t = await traccar();
    for (let i = 1; i <= 12; i++) console.log('traccar', imei(i), '->', await t.garantirDevice(`DEMO ${i}`, imei(i)));
    console.log('placas:', VEICULOS.map((_, i) => veiculoDoSgaSimulado(i).placa).join(' '));
    return;
  }
  const T = tenant.id;

  await prisma.tenantSettings.upsert({
    where: { tenantId: T },
    create: { tenantId: T, notifyChannels: { email: false, push: true, whatsapp: false } },
    update: { notifyChannels: { email: false, push: true, whatsapp: false } },
  });

  const hash = await bcrypt.hash(SENHA, 10);
  await prisma.user.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, name: 'Visitante (Demonstração)', password: hash, role: 'SUPER_ADMIN', tenantId: T, mustChangePassword: false },
    update: { password: hash, role: 'SUPER_ADMIN', tenantId: T, active: true, mustChangePassword: false, deletedAt: null },
  });
  for (const [email, name, role] of [
    ['operador.demo@trackgo.site', 'Operador Demonstração', 'OPERATOR'],
    ['gestor.demo@trackgo.site', 'Gestor Demonstração', 'ADMIN'],
  ]) {
    await prisma.user.upsert({
      where: { email },
      create: { email, name, password: await bcrypt.hash(`${SENHA}-${role}`, 10), role, tenantId: T, mustChangePassword: false },
      update: {},
    });
  }

  const tc = await traccar();
  const associados = [];
  for (let a = 0; a < ASSOCIADOS.length; a++) {
    const cpf = veiculoDoSgaSimulado(a).cpf;
    let assoc = await prisma.associate.findFirst({ where: { tenantId: T, cpf } });
    if (!assoc) {
      assoc = await prisma.associate.create({
        data: {
          tenantId: T, name: ASSOCIADOS[a], cpf, phone: null,
          email: `associado${a + 1}.demo@trackgo.site`, hinovaCode: `ASS${String(a + 1).padStart(6, '0')}`,
          birthDate: new Date(1975 + a * 2, a % 12, 10 + a), mustChangePassword: false,
        },
      });
    }
    associados.push(assoc);
  }

  for (let i = 0; i < VEICULOS.length; i++) {
    const [brand, model, color, year, tipo] = VEICULOS[i];
    const { placa } = veiculoDoSgaSimulado(i);
    const id = imei(i + 1);
    const traccarId = await tc.garantirDevice(`${placa} (DEMO)`, id);
    const veiculo = await prisma.vehicle.upsert({
      where: { uniqueId: id },
      create: {
        tenantId: T, plate: placa, uniqueId: id, traccarDeviceId: traccarId, brand, model, color, year,
        vehicleType: tipo, associateId: associados[DONO[i]].id, hinovaCode: `HNV${String(i + 1).padStart(6, '0')}`,
        financialStatus: i === 9 ? 'INADIMPLENTE' : 'ADIMPLENTE', financialStatusAt: new Date(),
        sgaStatusLabel: 'ATIVO', status: 'ACTIVE',
        chassi: `9BWDEMO${String(100000 + i * 37).padStart(10, '0')}`, renavam: String(90000000000 + i * 1013),
      },
      update: { traccarDeviceId: traccarId },
    });
    const chip = await prisma.chip.upsert({
      where: { iccid: iccid(i + 1) },
      create: { tenantId: T, iccid: iccid(i + 1), operator: i % 2 ? 'CLARO' : 'VIVO', apn: i % 2 ? 'claro.com.br' : 'zap.vivo.com.br', phoneNumber: null, activatedAt: dias(120 - i * 5) },
      update: {},
    });
    await prisma.device.upsert({
      where: { imei: id },
      create: {
        tenantId: T, imei: id, model: i % 3 === 0 ? 'J16' : 'GT06', status: 'INSTALLED', traccarDeviceId: traccarId,
        vehicleId: veiculo.id, chipId: chip.id, installedAt: dias(90 - i * 6), installedBy: 'Técnico Demonstração',
        installLocation: 'Atrás do painel',
      },
      update: { traccarDeviceId: traccarId, vehicleId: veiculo.id },
    });
    console.log('veículo', placa, model, 'traccar', traccarId);
  }

  // Estoque: 8 rastreadores e 4 TAGs na prateleira, mais 4 chips soltos.
  for (let n = 1; n <= 8; n++) {
    const id = imei(100 + n);
    await prisma.stockItem.upsert({
      where: { tenantId_imei: { tenantId: T, imei: id } },
      create: { tenantId: T, imei: id, kind: 'RASTREADOR', iccid: iccid(100 + n), operator: n % 2 ? 'VIVO' : 'CLARO', status: 'ATIVO', registeredAt: dias(20 - n) },
      update: {},
    });
  }
  for (let n = 1; n <= 4; n++) {
    const id = `DEMOTAG${String(n).padStart(6, '0')}`;
    await prisma.stockItem.upsert({
      where: { tenantId_imei: { tenantId: T, imei: id } },
      create: { tenantId: T, imei: id, kind: 'TAG', registeredAt: dias(10 - n) },
      update: {},
    });
  }
  for (let n = 1; n <= 4; n++) {
    await prisma.chip.upsert({
      where: { iccid: iccid(200 + n) },
      create: { tenantId: T, iccid: iccid(200 + n), operator: 'TIM', apn: 'timbrasil.br' },
      update: {},
    });
  }

  for (const [k, nome] of ['Rafael Técnico (Demo)', 'Sabrina Técnica (Demo)', 'Tiago Técnico (Demo)'].entries()) {
    const cpf = veiculoDoSgaSimulado(300 + k).cpf;
    const existe = await prisma.technician.findFirst({ where: { tenantId: T, cpf } });
    if (!existe) {
      await prisma.technician.create({
        data: { tenantId: T, name: nome, cpf, phone: null, email: `tecnico${k + 1}.demo@trackgo.site`, password: await bcrypt.hash(`${SENHA}-TEC`, 10), mustChangePassword: false },
      });
    }
  }

  const cercas = [
    { name: 'Base Demonstração (Centro)', type: 'CIRCLE', coordinates: { center: [-22.9035, -43.1772], radius: 600 }, color: '#10b981' },
    { name: 'Área de risco (Demo)', type: 'CIRCLE', coordinates: { center: [-22.8805, -43.2465], radius: 900 }, color: '#ef4444' },
  ];
  for (const c of cercas) {
    const existe = await prisma.geofence.findFirst({ where: { tenantId: T, name: c.name } });
    if (!existe) await prisma.geofence.create({ data: { ...c, tenantId: T } });
  }

  const pendencias = [
    ['Laura Mendes (Demo)', 'Jeep Compass', 'Copacabana', -22.9711, -43.1863, 'TRACKER', 3],
    ['Marcos Vieira (Demo)', 'Fiat Pulse', 'Tijuca', -22.9249, -43.2329, 'TRACKER', 6],
    ['Natália Freire (Demo)', 'Honda CB 300F', 'Méier', -22.9020, -43.2790, 'TAG', 2],
    ['Otávio Reis (Demo)', 'VW Nivus', 'Barra da Tijuca', -23.0004, -43.3659, 'TRACKER', 9],
    ['Paula Siqueira (Demo)', 'Hyundai Creta', 'Niterói - Icaraí', -22.9068, -43.1100, 'TAG', 1],
  ];
  for (const [k, [nome, carro, bairro, lat, lng, tipo, ha]] of pendencias.entries()) {
    const codigo = `DEMOPEND${k + 1}`;
    const { placa } = veiculoDoSgaSimulado(400 + k);
    await prisma.installationPending.upsert({
      where: { tenantId_hinovaVehicleCode: { tenantId: T, hinovaVehicleCode: codigo } },
      create: {
        tenantId: T, hinovaVehicleCode: codigo, plate: placa, pendingType: tipo, associateName: nome,
        associateCode: `ASSP${k + 1}`, brandModel: carro, city: 'Rio de Janeiro', neighborhood: bairro,
        protectedValue: 60000 + k * 9000, contractDate: dias(ha), lat, lng, consultantName: 'Consultor Demonstração',
        syncedAt: new Date(),
      },
      update: {},
    });
  }

  const veiculos = await prisma.vehicle.findMany({ where: { tenantId: T }, select: { id: true, plate: true } });
  const jaTem = await prisma.alert.count({ where: { tenantId: T } });
  if (jaTem === 0) {
    const modelos = [
      ['SPEED', 'WARNING', 'Velocidade de 127 km/h na Av. Brasil'],
      ['IGNITION_ON', 'INFO', 'Ignição ligada'],
      ['GEOFENCE_OUT', 'WARNING', 'Saiu da cerca Base Demonstração (Centro)'],
      ['POWER_CUT', 'CRITICAL', 'Alimentação do rastreador cortada'],
      ['OFFLINE', 'WARNING', 'Rastreador sem comunicação há 2 horas'],
      ['HARSH_BRAKE', 'INFO', 'Frenagem brusca detectada'],
    ];
    for (let k = 0; k < 18; k++) {
      const [type, severity, message] = modelos[k % modelos.length];
      const v = veiculos[k % veiculos.length];
      await prisma.alert.create({
        data: {
          tenantId: T, vehicleId: v.id, type, severity, message: `${v.plate}: ${message}`,
          status: k < 6 ? 'OPEN' : 'RESOLVED', read: k >= 6, resolvedAt: k < 6 ? null : dias(k / 3),
          createdAt: dias(k / 2 + 0.1),
        },
      });
    }
  }

  console.log('pronto. login:', EMAIL);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
