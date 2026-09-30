import { seriaisComPosicao, ultimasPosicoes } from './clients-tags';

/**
 * A última posição de cada TAG tem que sair do índice, não de uma varredura.
 *
 * Medido em produção em 30/09/2026: `SELECT DISTINCT ON (serial_number) …
 * ORDER BY serial_number, seen_at DESC` lia os 5,1 milhões de avistamentos a
 * cada chamada (8,9 s) — e a lista de TAGs do mapa chama isso a cada minuto por
 * operador. A forma com `LATERAL … LIMIT 1` por número fez o mesmo em 0,26 s.
 */
const TENANT = '11111111-1111-1111-1111-111111111111';

function sqlEnviado(queryRaw: jest.Mock): string {
  const chamada = queryRaw.mock.calls[0][0] as { sql?: string; strings?: string[] };
  return chamada.sql ?? (chamada.strings ?? []).join('?');
}

describe('ultimasPosicoes — uma busca por TAG no índice', () => {
  it('usa LATERAL + LIMIT 1 por número, nunca DISTINCT ON sobre a tabela inteira', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };
    await ultimasPosicoes(prisma as never, TENANT, ['808092605075440', '808092604074873']);

    const sql = sqlEnviado(prisma.$queryRaw);
    expect(sql).toMatch(/LATERAL/i);
    expect(sql).toMatch(/LIMIT 1/i);
    expect(sql).not.toMatch(/DISTINCT ON/i);
  });

  it('devolve a posição pelo número, no formato que o mapa e o estoque já usam', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          serial_number: '808092605075440',
          latitude: -22.98817,
          longitude: -43.46588,
          accuracy_m: 36,
          seen_at: new Date('2026-09-30T14:06:00Z'),
        },
      ]),
    };
    const pos = await ultimasPosicoes(prisma as never, TENANT, ['808092605075440']);
    expect(pos.get('808092605075440')).toEqual({
      lat: -22.98817,
      lng: -43.46588,
      accuracyM: 36,
      seenAt: new Date('2026-09-30T14:06:00Z'),
    });
  });

  it('sem números não vai ao banco', async () => {
    const prisma = { $queryRaw: jest.fn() };
    const pos = await ultimasPosicoes(prisma as never, TENANT, []);
    expect(pos.size).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('seriaisComPosicao — "quem já foi vista" também sai do índice', () => {
  it('usa EXISTS por número, nunca DISTINCT sobre a tabela inteira', async () => {
    // Medido em produção em 30/09/2026: `SELECT DISTINCT serial_number … IN (4,5 mil)`
    // virava Parallel Seq Scan em 5,1 M linhas (1,2 s quente); EXISTS: 0,14 s.
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ serial_number: '808092605075440' }]),
    };
    const r = await seriaisComPosicao(prisma as never, TENANT, ['808092605075440', '1']);
    expect([...r]).toEqual(['808092605075440']);
    const sql = sqlEnviado(prisma.$queryRaw);
    expect(sql).toMatch(/EXISTS/i);
    expect(sql).not.toMatch(/DISTINCT/i);
  });
});
