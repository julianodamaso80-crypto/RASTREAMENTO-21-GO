import type { PrismaService } from '../prisma/prisma.service';

/**
 * Regra ÚNICA para "este número é TAG?". Dono, 03/11/2026: TAG aparecendo como
 * rastreador "nunca pode acontecer". Antes cada caminho decidia sozinho e o
 * padrão do banco é RASTREADOR: a TAG híbrida do lote 868294 fala com o gps1
 * como gt06 e a adoção automática a gravava como rastreador; o vínculo em
 * massa só reconhecia TAG de 11 dígitos e criava Device para a de 15.
 *
 * É TAG quando:
 * - não tem 15 dígitos (IMEI de rastreador sempre tem 15); ou
 * - tem chave Find My (`tag_keys`); ou
 * - é do mesmo lote (6 primeiros dígitos) de uma TAG já no Estoque.
 */
export async function seriaisDeTag(
  prisma: PrismaService,
  tenantId: string,
  seriais: string[],
): Promise<Set<string>> {
  const unicos = [...new Set(seriais.map((s) => s.trim()).filter(Boolean))];
  const tags = new Set(unicos.filter((s) => s.length !== 15));
  const quinze = unicos.filter((s) => s.length === 15);
  if (quinze.length === 0) return tags;

  const comChave = await prisma.tagKey.findMany({
    where: { serialNumber: { in: quinze } },
    select: { serialNumber: true },
  });
  for (const k of comChave) tags.add(k.serialNumber);

  const lotes = [...new Set(quinze.filter((s) => !tags.has(s)).map((s) => s.slice(0, 6)))];
  if (lotes.length > 0) {
    const lotesDeTag = new Set<string>();
    await Promise.all(
      lotes.map(async (lote) => {
        const n = await prisma.stockItem.count({
          where: { tenantId, kind: 'TAG', imei: { startsWith: lote } },
        });
        if (n > 0) lotesDeTag.add(lote);
      }),
    );
    for (const s of quinze) if (lotesDeTag.has(s.slice(0, 6))) tags.add(s);
  }
  return tags;
}

export async function ehSerialDeTag(
  prisma: PrismaService,
  tenantId: string,
  serial: string,
): Promise<boolean> {
  return (await seriaisDeTag(prisma, tenantId, [serial])).has(serial.trim());
}
