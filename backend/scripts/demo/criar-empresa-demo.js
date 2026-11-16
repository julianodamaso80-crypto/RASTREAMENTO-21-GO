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

  await telasExtras(T, veiculos);

  // O painel exige WhatsApp confirmado de todo usuário. Na demo ele nasce
  // "confirmado" SEM número: nenhum código de recuperação sai para ninguém.
  await prisma.user.updateMany({ where: { tenantId: T }, data: { phoneVerifiedAt: new Date(), phone: null } });

  console.log('pronto. login:', EMAIL);
}

/** Consultores, Financeiro, Agenda, TAGs Ativas, Manutenção e Rotas — todos inventados. */
async function telasExtras(T, veiculos) {
  const tecnicos = await prisma.technician.findMany({ where: { tenantId: T }, orderBy: { name: 'asc' } });
  const veiculosCompletos = await prisma.vehicle.findMany({ where: { tenantId: T }, include: { associate: true, device: true } });

  // Consultores (powerId fictício a partir de 990001, nunca colide com o Power).
  const CONSULTORES = ['Ana Paula Lima (Demo)', 'Carlos Eduardo Reis (Demo)', 'Daniela Fontes (Demo)', 'Eduardo Pires (Demo)', 'Fernanda Alves (Demo)', 'Gustavo Melo (Demo)', 'Helena Castro (Demo)', 'Igor Santana (Demo)'];
  for (const [k, nome] of CONSULTORES.entries()) {
    await prisma.consultant.upsert({
      where: { tenantId_powerId: { tenantId: T, powerId: 990001 + k } },
      create: {
        tenantId: T, powerId: 990001 + k, name: nome, email: `consultor${k + 1}.demo@trackgo.site`,
        officeLabel: 'Consultor', branch: 'Rio de Janeiro', managerName: k ? CONSULTORES[0] : null,
        active: k !== 7, statusLabel: k !== 7 ? 'Ativo' : 'Bloqueado', powerCreatedAt: dias(400 - k * 30), lastAccessAt: dias(k % 4),
      },
      update: {},
    });
  }

  // Financeiro: lançamentos por placa e consultor nos últimos 3 meses.
  if ((await prisma.financialEntry.count({ where: { tenantId: T } })) === 0) {
    const status = ['PAID_PIX', 'PAID_PIX', 'MIGRATION', 'NO_RECEIPT'];
    const mes = new Date().getMonth() + 1;
    for (let k = 0; k < 16; k++) {
      await prisma.financialEntry.create({
        data: {
          tenantId: T, plate: veiculoDoSgaSimulado(500 + k).placa, status: status[k % 4],
          month: ((mes - 1 - (k % 3) + 12) % 12) + 1, consultantName: CONSULTORES[k % CONSULTORES.length],
          plateCount: k % 5 === 0 ? 2 : 1, createdAt: dias(k * 4),
        },
      });
    }
  }

  // Agenda: ordens de serviço da semana, com técnicos fictícios.
  if ((await prisma.appointment.count({ where: { tenantId: T } })) === 0) {
    const tipos = ['INSTALLATION', 'INSTALLATION', 'MAINTENANCE', 'REMOVAL'];
    const sit = ['SCHEDULED', 'SCHEDULED', 'EXECUTED', 'SCHEDULED', 'POSTPONED', 'SCHEDULED', 'EXECUTED', 'CANCELED', 'SCHEDULED', 'SCHEDULED'];
    const bairros = [['Copacabana', -22.9711, -43.1863], ['Tijuca', -22.9249, -43.2329], ['Méier', -22.902, -43.279], ['Barra da Tijuca', -23.0004, -43.3659], ['Icaraí, Niterói', -22.9068, -43.11]];
    for (let k = 0; k < 10; k++) {
      const inicio = new Date(); inicio.setHours(8 + (k % 4) * 2, 0, 0, 0); inicio.setDate(inicio.getDate() + (k % 5) - 1);
      const fim = new Date(inicio.getTime() + 90 * 60000);
      const v = veiculosCompletos[k % veiculosCompletos.length];
      const [bairro, lat, lng] = bairros[k % bairros.length];
      await prisma.appointment.create({
        data: {
          tenantId: T, osNumber: `DEMO-${String(k + 1).padStart(4, '0')}`, serviceType: tipos[k % 4],
          maintenanceReason: tipos[k % 4] === 'MAINTENANCE' ? 'SIGNAL_FAILURE' : null,
          scheduledStart: inicio, scheduledEnd: fim, technicianId: tecnicos[k % tecnicos.length].id,
          status: sit[k], completedAt: sit[k] === 'EXECUTED' ? fim : null,
          vehicleId: tipos[k % 4] === 'INSTALLATION' ? null : v.id, plate: v.plate, brand: v.brand, model: v.model,
          imei: v.device?.imei ?? null, clientName: v.associate?.name ?? 'Cliente Demonstração',
          address: `Rua Fictícia, ${100 + k} - ${bairro}`, lat, lng, value: 80 + (k % 3) * 20,
          description: 'Ordem de serviço de demonstração',
        },
      });
    }
  }

  // TAGs ativas: clientes com TAG no "SGA" simulado e posição da TAG.
  const tags = [
    ['Lucas Andrade (Demo)', 'Fiat Mobi', -22.9095, -43.1745, '9'],
    ['Mariana Borges (Demo)', 'VW Gol', -22.9301, -43.2402, '9'],
    ['Nelson Prado (Demo)', 'Chevrolet Spin', -22.8873, -43.2851, '8'],
    ['Olívia Rangel (Demo)', 'Hyundai Creta', -23.0071, -43.3311, '9'],
    ['Pedro Lacerda (Demo)', 'Toyota Yaris', -22.9012, -43.1092, '8'],
  ];
  for (const [k, [nome, carro, lat, lng, adesao]] of tags.entries()) {
    const placa = veiculoDoSgaSimulado(600 + k).placa;
    const codigo = `HNVTAG${k + 1}`;
    const serial = `DEMOTAG${String(k + 1).padStart(6, '0')}`;
    const sga = await prisma.sgaVehicle.findFirst({ where: { tenantId: T, hinovaVehicleCode: codigo } });
    if (!sga) {
      await prisma.sgaVehicle.create({
        data: {
          tenantId: T, hinovaVehicleCode: codigo, plate: placa, associateName: nome, associateCode: `ASST${k + 1}`,
          cpf: veiculoDoSgaSimulado(700 + k).cpf, brandModel: carro, situationCode: '1', situationLabel: 'ATIVO',
          adhesionCode: adesao, vehicleType: 'CAR', contractDate: dias(30 + k * 11), syncedAt: new Date(),
        },
      });
    }
    await prisma.rdvTag.upsert({
      where: { tenantId_tagIdentifier: { tenantId: T, tagIdentifier: serial } },
      create: { tenantId: T, tagIdentifier: serial, plate: placa, tagModel: 'TAG BLE', lastLat: lat, lastLng: lng, seenAt: dias(k * 0.05), source: 'DEMO' },
      update: { lastLat: lat, lastLng: lng, seenAt: dias(k * 0.05) },
    });
    if ((await prisma.tagPosition.count({ where: { tenantId: T, serialNumber: serial } })) === 0) {
      for (let p = 0; p < 6; p++) {
        await prisma.tagPosition.create({
          data: { tenantId: T, serialNumber: serial, plate: placa, latitude: lat + p * 0.0012, longitude: lng - p * 0.0009, accuracyM: 15, seenAt: dias(p * 0.2 + k * 0.01), source: 'DEMO' },
        });
      }
    }
  }

  // Manutenção preventiva: planos em dia, próximos e vencidos.
  if ((await prisma.maintenancePlan.count({ where: { tenantId: T } })) === 0) {
    const planos = [['OIL_CHANGE', 'Troca de óleo', 10000, 6, 'UPCOMING'], ['TIRES', 'Rodízio de pneus', 10000, 12, 'DUE'], ['BRAKES', 'Pastilhas de freio', 20000, 12, 'OVERDUE'], ['ALIGNMENT', 'Alinhamento', 10000, 6, null]];
    for (let k = 0; k < 8; k++) {
      const [type, name, km, meses, sev] = planos[k % planos.length];
      await prisma.maintenancePlan.create({
        data: { tenantId: T, vehicleId: veiculosCompletos[k].id, type, name, intervalKm: km, intervalMonths: meses, lastDoneAt: dias(60 + k * 25), lastDoneKm: 20000 + k * 3500, severity: sev },
      });
    }
  }

  // Rota inteligente: uma rota montada para um técnico com 3 paradas.
  if ((await prisma.installationRoute.count({ where: { tenantId: T } })) === 0) {
    const pend = await prisma.installationPending.findMany({ where: { tenantId: T }, take: 3, orderBy: { contractDate: 'asc' } });
    const rota = await prisma.installationRoute.create({ data: { tenantId: T, technicianId: tecnicos[0].id, status: 'PENDING' } });
    for (const [k, p] of pend.entries()) {
      await prisma.routeStop.create({
        data: {
          routeId: rota.id, order: k + 1, hinovaVehicleCode: p.hinovaVehicleCode, plate: p.plate, pendingType: p.pendingType,
          associateName: p.associateName, brandModel: p.brandModel, neighborhood: p.neighborhood, city: p.city, lat: p.lat, lng: p.lng,
        },
      });
    }
  }
  console.log('telas extras: consultores, financeiro, agenda, TAGs, manutenção e rota prontos');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
