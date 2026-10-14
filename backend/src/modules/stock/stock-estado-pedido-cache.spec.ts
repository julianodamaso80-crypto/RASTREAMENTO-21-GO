import { StockService } from './stock.service';
import * as tags from '../clients/clients-tags';

jest.mock('../clients/clients-tags', () => ({
  ...jest.requireActual('../clients/clients-tags'),
  invalidarCacheDeTags: jest.fn(),
}));

describe('StockService.estadoDoPedido — cache de TAGs', () => {
  const montar = () => {
    const svc = Object.create(StockService.prototype) as any;
    svc.prisma = { $queryRaw: jest.fn().mockResolvedValue([{ max: null }]) };
    return svc;
  };
  const pedido = (imei: string, doneAt: Date | null) => ({
    item: { imei },
    ultima: { requestedAt: new Date('2026-10-14T10:00:00Z'), doneAt, positionsFound: 2 },
  });

  beforeEach(() => (tags.invalidarCacheDeTags as jest.Mock).mockClear());

  it('invalida o cache só na primeira vez que o doneAt é observado', async () => {
    const svc = montar();
    const feito = new Date('2026-10-14T10:01:00Z');
    await svc.estadoDoPedido(pedido('111', feito), 't1');
    await svc.estadoDoPedido(pedido('111', feito), 't1');
    expect(tags.invalidarCacheDeTags).toHaveBeenCalledTimes(1);
    expect(tags.invalidarCacheDeTags).toHaveBeenCalledWith('t1');
  });

  it('pedido ainda pendente não invalida', async () => {
    const svc = montar();
    await svc.estadoDoPedido(pedido('222', null), 't1');
    expect(tags.invalidarCacheDeTags).not.toHaveBeenCalled();
  });
});
