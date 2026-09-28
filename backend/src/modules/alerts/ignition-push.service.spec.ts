import { IgnitionPushService, INTERVALO_MINIMO_MS, textoDaIgnicao } from './ignition-push.service';

function montar(associate: Record<string, unknown> | null, veiculo = true) {
  const prisma = {
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(
        veiculo ? { plate: 'ABC1D23', associate } : null,
      ),
    },
  } as any;
  const push = { enviar: jest.fn().mockResolvedValue(true) } as any;
  return { s: new IgnitionPushService(prisma, push), prisma, push };
}

const quem = (on: boolean, off: boolean) => ({
  id: 'a1',
  deletedAt: null,
  notifyIgnitionOn: on,
  notifyIgnitionOff: off,
});

describe('textoDaIgnicao', () => {
  it('diz placa, sentido e hora de Brasília', () => {
    // 17:05 UTC = 14:05 em Brasília
    expect(textoDaIgnicao('ABC1D23', true, new Date('2026-09-28T17:05:00Z'))).toBe(
      'A chave do veículo ABC1D23 foi ligada às 14:05.',
    );
    expect(textoDaIgnicao('ABC1D23', false, new Date('2026-09-28T17:05:00Z'))).toBe(
      'A chave do veículo ABC1D23 foi desligada às 14:05.',
    );
  });
});

describe('IgnitionPushService.avisar', () => {
  const t0 = new Date('2026-09-28T17:05:00Z');

  it('quem não ligou a opção não recebe (padrão)', async () => {
    const { s, push } = montar(quem(false, false));
    await s.avisar('v1', 't1', true, t0);
    await s.avisar('v1', 't1', false, t0);
    expect(push.enviar).not.toHaveBeenCalled();
  });

  it('respeita cada sentido separado', async () => {
    const { s, push } = montar(quem(true, false));
    await s.avisar('v1', 't1', false, t0);
    expect(push.enviar).not.toHaveBeenCalled();
    await s.avisar('v1', 't1', true, t0);
    expect(push.enviar).toHaveBeenCalledWith(
      'a1',
      't1',
      'A chave do veículo ABC1D23 foi ligada às 14:05.',
      { rota: '/(tabs)' },
    );
  });

  it('filtra por tenant, veículo ativo e acesso ao app liberado', async () => {
    const { s, prisma } = montar(quem(true, true));
    await s.avisar('v1', 't1', true, t0);
    expect(prisma.vehicle.findFirst.mock.calls[0][0].where).toEqual({
      id: 'v1',
      tenantId: 't1',
      deletedAt: null,
      appAccessBlocked: false,
    });
  });

  it('veículo sem associado, ou associado apagado, não avisa ninguém', async () => {
    const semDono = montar(null);
    await semDono.s.avisar('v1', 't1', true, t0);
    expect(semDono.push.enviar).not.toHaveBeenCalled();

    const apagado = montar({ ...quem(true, true), deletedAt: new Date() });
    await apagado.s.avisar('v1', 't1', true, t0);
    expect(apagado.push.enviar).not.toHaveBeenCalled();
  });

  it('ignição oscilando não vira rajada de push', async () => {
    const { s, push } = montar(quem(true, true));
    await s.avisar('v1', 't1', true, t0);
    await s.avisar('v1', 't1', true, new Date(t0.getTime() + 30_000));
    expect(push.enviar).toHaveBeenCalledTimes(1);
    await s.avisar('v1', 't1', true, new Date(t0.getTime() + INTERVALO_MINIMO_MS));
    expect(push.enviar).toHaveBeenCalledTimes(2);
  });

  it('erro de banco não escapa (roda solto no processamento de posição)', async () => {
    const { s, prisma, push } = montar(quem(true, true));
    prisma.vehicle.findFirst.mockRejectedValue(new Error('db caiu'));
    await expect(s.avisar('v1', 't1', true, t0)).resolves.toBeUndefined();
    expect(push.enviar).not.toHaveBeenCalled();
  });
});
