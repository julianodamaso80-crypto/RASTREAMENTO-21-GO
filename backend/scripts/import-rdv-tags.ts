/**
 * Carga do espelho `rdv_tags` a partir do extrato da plataforma de origem.
 *
 * Uso:
 *   npx ts-node scripts/import-rdv-tags.ts <arquivo.json> [--tenant <uuid>] [--dry]
 *
 * O arquivo é `{ tags: TagRdvBruta[], modeloPorPlaca: Record<string,string[]> }`.
 *
 * Idempotente: a chave é (tenant, tagIdentifier), então rodar de novo atualiza
 * posição e carimbo em vez de duplicar. Nunca apaga linha — TAG que sumiu do
 * extrato pode ser falha de leitura, e apagar perderia a última pista conhecida.
 */
import { PrismaClient } from '.prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  mapearTagRdv,
  type LinhaEspelho,
  type TagRdvBruta,
} from '../src/modules/ble-tags/rdv-tag-import';

const LOTE = 500;

async function main() {
  const [arquivo] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!arquivo) {
    console.error('uso: import-rdv-tags.ts <arquivo.json> [--tenant <uuid>] [--dry]');
    process.exit(1);
  }
  const dry = process.argv.includes('--dry');
  const iSql = process.argv.indexOf('--sql');
  const sqlOut = iSql >= 0 ? process.argv[iSql + 1] : null;
  const iTenant = process.argv.indexOf('--tenant');
  const tenantArg = iTenant >= 0 ? process.argv[iTenant + 1] : null;

  // O `--dry` não pode exigir banco: ele existe justamente pra conferir o
  // parse antes de ter conexão com produção.
  const prisma = dry || sqlOut ? null : new PrismaClient();
  try {
    const tenantId =
      dry || sqlOut
        ? (tenantArg ?? '(dry)')
        : (tenantArg ?? (await tenantUnico(prisma!)));

    const bruto = JSON.parse(readFileSync(arquivo, 'utf-8'));
    const tags: TagRdvBruta[] = bruto.tags ?? bruto;
    const modeloPorPlaca: Record<string, string[]> = bruto.modeloPorPlaca ?? {};

    const linhas = tags
      .map((t) => mapearTagRdv(t, modeloPorPlaca))
      .filter((l): l is NonNullable<typeof l> => l !== null);

    // Mesma TAG pode vir duas vezes (placa repetida no extrato): fica a vista
    // mais recente, a mesma regra que a tela aplica.
    const porChave = new Map<string, (typeof linhas)[number]>();
    for (const l of linhas) {
      const atual = porChave.get(l.tagIdentifier);
      const novo = l.seenAt?.getTime() ?? -Infinity;
      const velho = atual?.seenAt?.getTime() ?? -Infinity;
      if (!atual || novo > velho) porChave.set(l.tagIdentifier, l);
    }
    const finais = [...porChave.values()];

    const comPosicao = finais.filter((l) => l.lastLat !== null).length;
    console.log(
      `lidas ${tags.length} · válidas ${linhas.length} · únicas ${finais.length} · com posição ${comPosicao}`,
    );
    if (sqlOut) {
      // O Postgres de produção não é exposto pra fora: a carga vai por psql
      // dentro do container. Gerar o SQL aqui mantém a tradução (coordenada
      // (0,0), fuso de Brasília) na mesma função já coberta por teste.
      if (!tenantArg) throw new Error('--sql exige --tenant <uuid> explícito');
      writeFileSync(sqlOut, montarSql(finais, tenantArg), 'utf-8');
      console.log(`SQL de ${finais.length} TAGs em ${sqlOut}`);
      return;
    }

    if (dry) {
      console.log('--dry: nada gravado');
      console.log(JSON.stringify(finais.slice(0, 3), null, 2));
      return;
    }

    let gravadas = 0;
    for (let i = 0; i < finais.length; i += LOTE) {
      const fatia = finais.slice(i, i + LOTE);
      await prisma!.$transaction(
        fatia.map((l) =>
          (prisma as any).rdvTag.upsert({
            where: {
              tenantId_tagIdentifier: {
                tenantId,
                tagIdentifier: l.tagIdentifier,
              },
            },
            create: { ...l, tenantId },
            update: { ...l, syncedAt: new Date() },
          }),
        ),
      );
      gravadas += fatia.length;
      console.log(`  ${gravadas}/${finais.length}`);
    }
    console.log(`pronto: ${gravadas} TAGs no espelho do tenant ${tenantId}`);
  } finally {
    await prisma?.$disconnect();
  }
}

/** Literal SQL de texto, com aspas escapadas. `null` vira NULL de verdade. */
function txt(v: string | null): string {
  return v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`;
}

/**
 * UPSERT por (tenant, tag_identifier): rodar de novo atualiza posição e carimbo
 * em vez de duplicar. Nunca apaga — TAG ausente do extrato pode ser falha de
 * leitura, e apagar perderia a última pista conhecida.
 */
function montarSql(linhas: LinhaEspelho[], tenantId: string): string {
  const valores = linhas
    .map(
      (l) =>
        `  (gen_random_uuid(), ${txt(l.tagIdentifier)}, ${txt(l.plate)}, ${txt(l.chassi)}, ` +
        `${txt(l.tagModel)}, ${l.lastLat ?? 'NULL'}, ${l.lastLng ?? 'NULL'}, ` +
        `${l.seenAt ? txt(l.seenAt.toISOString()) + '::timestamp' : 'NULL'}, ` +
        `${txt(l.sourceAssetId)}, 'REDEVEICULOS', ${txt(tenantId)}::uuid, NOW(), NOW(), NOW())`,
    )
    .join(',\n');

  return `BEGIN;
INSERT INTO rdv_tags (
  id, tag_identifier, plate, chassi, tag_model, last_lat, last_lng,
  seen_at, source_asset_id, source, tenant_id, synced_at, created_at, updated_at
) VALUES
${valores}
ON CONFLICT (tenant_id, tag_identifier) DO UPDATE SET
  plate = EXCLUDED.plate,
  chassi = EXCLUDED.chassi,
  tag_model = EXCLUDED.tag_model,
  last_lat = EXCLUDED.last_lat,
  last_lng = EXCLUDED.last_lng,
  seen_at = EXCLUDED.seen_at,
  source_asset_id = EXCLUDED.source_asset_id,
  synced_at = NOW(),
  updated_at = NOW();
COMMIT;
`;
}

async function tenantUnico(prisma: PrismaClient): Promise<string> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  if (tenants.length !== 1) {
    throw new Error(
      `há ${tenants.length} tenants — passe --tenant <uuid> pra não gravar no errado`,
    );
  }
  return tenants[0].id;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
