import { InstallationPendingsService } from './installation-pendings.service';

/**
 * Depois de um restart, a fila ficava parada até o próximo horário do cron.
 *
 * `cargaInicial` só disparava com a tabela VAZIA. Como ela quase nunca está,
 * o backend que subisse às 09h50 — exatamente o que aconteceu em 03/09/2026,
 * quando o container morreu por falta de memória no meio do sync das 09h —
 * ficava sem sincronizar até as 17h. A tela mostrava "atualizado há 23h" e o
 * operador concluía, com razão, que o sincronismo automático não acontece.
 *
 * O gatilho passa a ser a IDADE do dado, não o vazio.
 */
describe('retomada do sync no boot', () => {
  function montar(ultimoSyncHaHoras: number | null) {
    const sync = jest.fn().mockResolvedValue({});
    const prisma = {
      installationPending: {
        count: jest.fn().mockResolvedValue(ultimoSyncHaHoras === null ? 0 : 8449),
        findFirst: jest.fn().mockResolvedValue(
          ultimoSyncHaHoras === null
            ? null
            : {
                syncedAt: new Date(
                  Date.now() - ultimoSyncHaHoras * 60 * 60 * 1000,
                ),
              },
        ),
      },
      tenant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tenant-1' }),
      },
    };
    const service = new InstallationPendingsService(
      { authenticate: jest.fn() } as never,
      prisma as never,
      { get: jest.fn().mockReturnValue('true') } as never,
      {} as never,
      {} as never,
    );
    (service as unknown as { sync: unknown }).sync = sync;
    return { service, sync, prisma };
  }

  it('ressincroniza quando o dado está velho (backend voltou depois do horário)', async () => {
    const { service, sync } = montar(23);

    await (
      service as unknown as { cargaInicial: () => Promise<void> }
    ).cargaInicial();

    expect(sync).toHaveBeenCalledWith('tenant-1');
  });

  it('não ressincroniza quando o dado é recente', async () => {
    const { service, sync } = montar(2);

    await (
      service as unknown as { cargaInicial: () => Promise<void> }
    ).cargaInicial();

    expect(sync).not.toHaveBeenCalled();
  });

  it('ainda faz a carga quando a fila está vazia', async () => {
    const { service, sync } = montar(null);

    await (
      service as unknown as { cargaInicial: () => Promise<void> }
    ).cargaInicial();

    expect(sync).toHaveBeenCalledWith('tenant-1');
  });
});
