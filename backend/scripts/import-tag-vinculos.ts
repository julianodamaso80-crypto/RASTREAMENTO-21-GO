/**
 * Carga das TAGs com chave: chaves do fabricante, vínculos conferidos na
 * RedeVeiculos e o estoque de TAG livre.
 *
 * Uso:
 *   npx ts-node scripts/import-tag-vinculos.ts <tag_seed.json> [--tenant <uuid>] [--dry]
 *
 * O arquivo tem { keys[], links[], stock[] } (ver o gerador na sessão). Tudo
 * idempotente:
 *   - tag_keys: upsert por (tenant, serialNumber) — não duplica ao rodar de novo.
 *   - tag_links: upsert do vínculo vivo por (tenant, serialNumber). Nunca cria
 *     Device/Vehicle/Associate (a TAG é segredo interno e o vehicle_id é único).
 *   - stock_items kind=TAG: upsert por (tenant, imei); só entra quem não tem
 *     vínculo. Se já foi vinculada, não volta pro estoque.
 *
 * A chave privada é validada (28 bytes) antes de gravar — o número de série no
 * lugar da chave faria o coletor consultar chave inexistente e receber silêncio.
 */
import { PrismaClient } from '.prisma/client';
import { readFileSync } from 'node:fs';

interface Seed {
  keys: Array<{ serialNumber: string; macAddress: string | null; privateKey: string; hashedAdvKey: string; batch: string }>;
  links: Array<{
    serialNumber: string;
    plate: string;
    chassi: string | null;
    hinovaVehicleCode: string | null;
    associateName: string | null;
    associateCpf: string | null;
    verdict: string;
    evidence: unknown;
  }>;
  stock: Array<{ imei: string; batch: string }>;
}

function tamanhoBase64(v: string): number {
  return Buffer.from(v, 'base64').length;
}

async function main() {
  const arquivo = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!arquivo) throw new Error('uso: import-tag-vinculos.ts <arquivo.json> [--tenant <uuid>] [--dry]');
  const dry = process.argv.includes('--dry');
  const iT = process.argv.indexOf('--tenant');
  const tenantArg = iT >= 0 ? process.argv[iT + 1] : null;

  const seed: Seed = JSON.parse(readFileSync(arquivo, 'utf-8'));

  // Toda chave é validada antes de qualquer escrita.
  for (const k of seed.keys) {
    if (tamanhoBase64(k.privateKey) !== 28 || tamanhoBase64(k.hashedAdvKey) !== 32) {
      throw new Error(`chave inválida no SN ${k.serialNumber}: privateKey ${tamanhoBase64(k.privateKey)}B, hash ${tamanhoBase64(k.hashedAdvKey)}B`);
    }
  }
  const vinculadas = new Set(seed.links.map((l) => l.serialNumber));
  const estoque = seed.stock.filter((s) => !vinculadas.has(s.imei));

  console.log(
    `Seed: ${seed.keys.length} chaves, ${seed.links.length} vínculos ` +
      `(${seed.links.filter((l) => l.verdict === 'CONFIRMADA').length} confirmados, ` +
      `${seed.links.filter((l) => l.verdict === 'DIVERGENTE').length} divergentes), ` +
      `${estoque.length} no estoque de TAG.`,
  );
  if (dry) {
    console.log('--dry: nada gravado.');
    return;
  }

  const prisma = new PrismaClient();
  try {
    const tenantId = tenantArg ?? (await tenantUnico(prisma));

    let chaves = 0;
    for (const k of seed.keys) {
      await prisma.tagKey.upsert({
        where: { tenantId_serialNumber: { tenantId, serialNumber: k.serialNumber } },
        create: { tenantId, ...k },
        update: { macAddress: k.macAddress, privateKey: k.privateKey, hashedAdvKey: k.hashedAdvKey, batch: k.batch },
      });
      chaves++;
    }

    let links = 0;
    for (const l of seed.links) {
      const existente = await prisma.tagLink.findFirst({
        where: { tenantId, serialNumber: l.serialNumber, deletedAt: null },
        select: { id: true },
      });
      const dados = {
        plate: l.plate,
        chassi: l.chassi,
        hinovaVehicleCode: l.hinovaVehicleCode,
        associateName: l.associateName,
        associateCpf: l.associateCpf,
        origin: 'REDE',
        verdict: l.verdict,
        evidence: l.evidence as object,
        checkedAt: new Date(),
      };
      if (existente) {
        await prisma.tagLink.update({ where: { id: existente.id }, data: dados });
      } else {
        await prisma.tagLink.create({ data: { tenantId, serialNumber: l.serialNumber, ...dados } });
      }
      links++;
    }

    let estoqueOk = 0;
    for (const s of estoque) {
      // Se essa TAG já foi vinculada pelo estoque (associatedAt), não reabrir.
      const existente = await prisma.stockItem.findFirst({
        where: { tenantId, imei: s.imei },
        select: { id: true, associatedAt: true, kind: true },
      });
      if (existente) {
        if (!existente.associatedAt && existente.kind !== 'TAG') {
          await prisma.stockItem.update({ where: { id: existente.id }, data: { kind: 'TAG' } });
        }
      } else {
        await prisma.stockItem.create({
          data: { tenantId, imei: s.imei, kind: 'TAG', status: 'TAG', notes: `Lote ${s.batch}` },
        });
      }
      estoqueOk++;
    }

    console.log(`Gravado: ${chaves} chaves, ${links} vínculos, ${estoqueOk} TAGs no estoque.`);
  } finally {
    await prisma.$disconnect();
  }
}

async function tenantUnico(prisma: PrismaClient): Promise<string> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  if (tenants.length !== 1) {
    throw new Error(`há ${tenants.length} tenants — passe --tenant <uuid>`);
  }
  return tenants[0].id;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
