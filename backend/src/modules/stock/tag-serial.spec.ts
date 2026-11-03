import { seriaisDeTag } from './tag-serial';

const TENANT = 'b55baec8-c4da-41b7-be9b-9da951710430';

function prisma(chaves: string[], lotesDeTag: string[]) {
  return {
    tagKey: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { serialNumber: { in: string[] } } }) =>
        Promise.resolve(where.serialNumber.in.filter((s) => chaves.includes(s)).map((serialNumber) => ({ serialNumber }))),
      ),
    },
    stockItem: {
      count: jest.fn().mockImplementation(({ where }: { where: { imei: { startsWith: string } } }) =>
        Promise.resolve(lotesDeTag.includes(where.imei.startsWith) ? 1 : 0),
      ),
    },
  };
}

describe('seriaisDeTag — regra única de TAG x rastreador', () => {
  it('casos reais de 03/11/2026', async () => {
    const r = await seriaisDeTag(prisma(['808092605161018'], ['868294']) as never, TENANT, [
      '808092605161018', // TAG com chave Find My, virou Device no vínculo em massa
      '868294085452035', // TAG híbrida sem chave, lote 868294 já no Estoque como TAG
      '92603008494', // TAG de 11 dígitos
      '867689069036871', // J16 de verdade
      '869890080092780', // J16 de verdade
    ]);
    expect([...r].sort()).toEqual(['808092605161018', '868294085452035', '92603008494']);
  });
});
