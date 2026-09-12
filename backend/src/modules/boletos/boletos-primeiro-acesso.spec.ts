import { BoletosController } from './boletos.controller';

const SEGUNDA_9H = new Date('2026-09-14T09:00:00-03:00');
const SABADO_MEIO_DIA = new Date('2026-09-12T12:00:00-03:00');

function monta(pendente: boolean) {
  const service = {
    listarDoAssociado: jest.fn().mockResolvedValue({ boletos: [], pendente, rodape: {} }),
    dadosParaSincronizar: jest
      .fn()
      .mockResolvedValue({ id: 'a1', tenantId: 't1', cpf: '11144477735' }),
  } as any;
  const sync = { sincronizarAssociado: jest.fn().mockResolvedValue({}) } as any;
  const push = {} as any;
  return { c: new BoletosController(service, push, sync), service, sync };
}

describe('GET /app/boletos — primeiro acesso', () => {
  afterEach(() => jest.useRealTimers());

  it('nunca visitado E SGA aberto: carrega na hora e devolve a lista recarregada', async () => {
    jest.useFakeTimers().setSystemTime(SEGUNDA_9H);
    const { c, service, sync } = monta(true);
    await c.listar('a1', 't1');
    expect(sync.sincronizarAssociado).toHaveBeenCalledTimes(1);
    // Sem PDF no caminho síncrono: baixar em série no meio da requisição HTTP
    // é o que estoura o timeout do celular (achado 1 da revisão).
    expect(sync.sincronizarAssociado).toHaveBeenCalledWith(
      { id: 'a1', tenantId: 't1', cpf: '11144477735' },
      { comPdf: false },
    );
    expect(service.listarDoAssociado).toHaveBeenCalledTimes(2);
  });

  it('sincronizar falha: nao estoura 500 pro associado, devolve o que ja tinha', async () => {
    jest.useFakeTimers().setSystemTime(SEGUNDA_9H);
    const { c, sync, service } = monta(true);
    sync.sincronizarAssociado.mockRejectedValue(new Error('CRM fora do ar'));
    const r = await c.listar('a1', 't1');
    expect(r).toEqual({ boletos: [], pendente: true, rodape: {} });
    expect(service.listarDoAssociado).toHaveBeenCalledTimes(1);
  });

  it('nunca visitado mas SGA fechado (sabado): NAO tenta carregar', async () => {
    jest.useFakeTimers().setSystemTime(SABADO_MEIO_DIA);
    const { c, sync } = monta(true);
    await c.listar('a1', 't1');
    expect(sync.sincronizarAssociado).not.toHaveBeenCalled();
  });

  it('ja visitado: nao carrega de novo, mesmo dentro da janela', async () => {
    jest.useFakeTimers().setSystemTime(SEGUNDA_9H);
    const { c, sync, service } = monta(false);
    await c.listar('a1', 't1');
    expect(sync.sincronizarAssociado).not.toHaveBeenCalled();
    expect(service.listarDoAssociado).toHaveBeenCalledTimes(1);
  });
});
