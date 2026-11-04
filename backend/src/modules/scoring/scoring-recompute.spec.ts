import { ScoringService } from './scoring.service';

/**
 * O recálculo diário do score lia 30 dias de posições de 8.656 veículos, um a
 * um, das 05:00 às ~13:30 (BRT) — o dia inteiro de trabalho com o Postgres a
 * 300 % e o backend a 130 % de CPU (medido em 04/11/2026). Agora roda à noite,
 * respeita um prazo e não refaz quem já tem o score do dia.
 */
function servico(jaFeitos: string[]) {
  const prisma = {
    vehicle: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'v1', tenantId: 't' },
        { id: 'v2', tenantId: 't' },
        { id: 'v3', tenantId: 't' },
      ]),
    },
    vehicleScore: {
      findMany: jest.fn().mockResolvedValue(jaFeitos.map((vehicleId) => ({ vehicleId }))),
    },
  };
  const s = new ScoringService(prisma as never);
  const compute = jest.spyOn(s, 'computeAndStore').mockResolvedValue(undefined as never);
  return { s, prisma, compute };
}

describe('ScoringService.recomputeAll — noturno, com prazo e sem refazer', () => {
  it('pula quem já tem o score do dia e computa o resto', async () => {
    const { s, compute, prisma } = servico(['v2']);
    const r = await s.recomputeAll();
    expect(compute.mock.calls.map((c) => c[0])).toEqual(['v1', 'v3']);
    expect(r).toEqual({ computados: 2, pulados: 1, interrompido: false });
    // a consulta dos já feitos é pelo balde do dia (00:00 UTC)
    const where = prisma.vehicleScore.findMany.mock.calls[0][0].where;
    expect(where.periodEnd).toBeInstanceOf(Date);
    expect(where.periodEnd.getUTCHours()).toBe(0);
  });

  it('para no prazo e diz quantos ficaram', async () => {
    const { s, compute } = servico([]);
    const t0 = Date.now();
    const agora = jest.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      // depois do 1º veículo o relógio passa do prazo
      compute.mockImplementation(async () => { agora.mockReturnValue(t0 + 10_000); return undefined as never; });
      const r = await s.recomputeAll(new Date(t0 + 5_000));
      expect(compute).toHaveBeenCalledTimes(1);
      expect(r).toEqual({ computados: 1, pulados: 0, interrompido: true });
    } finally {
      agora.mockRestore();
    }
  });

  it('prazo já vencido: não computa ninguém', async () => {
    const { s, compute } = servico([]);
    const r = await s.recomputeAll(new Date(Date.now() - 1));
    expect(compute).not.toHaveBeenCalled();
    expect(r.interrompido).toBe(true);
  });
});
