import { StockTraccarService } from './stock-traccar.service';
import { SEM_CONTATO_MS } from '../traccar/device-health.service';

/**
 * "Offline" no Estoque tem que bater com a realidade (dono, 30/09/2026): "se o
 * rastreador tá ligado você tá rastreando ele, não pode tá em off".
 *
 * O parque GT06/J16 cala quando o carro desliga e volta sozinho quando a chave
 * gira. Medido no Traccar em 30/09/2026: 97% dos rastreadores vivos ficam mudos
 * por mais de 1 h em qualquer janela de 2 dias. Chamar isso de OFFLINE depois de
 * 5 min mostrava 682 "offline" para 140 "online" num estoque onde 617 tinham
 * falado no mesmo dia. A régua agora é uma só: sem contato há mais de 72 h.
 */

const AGORA = Date.parse('2026-09-30T15:00:00Z');
const antes = (ms: number) => new Date(AGORA - ms).toISOString();

function device(id: number, uniqueId: string, status: string, lastUpdate: string | null) {
  return {
    id,
    name: uniqueId,
    uniqueId,
    status,
    lastUpdate,
    positionId: 0,
    groupId: 0,
    phone: '',
    model: '',
    contact: '',
    category: '',
    disabled: false,
    attributes: {},
  };
}

function posicaoFresca(deviceId: number) {
  return {
    id: deviceId,
    deviceId,
    latitude: -22.9,
    longitude: -43.5,
    altitude: 0,
    speed: 0,
    course: 0,
    valid: true,
    accuracy: 5,
    fixTime: antes(60_000),
    deviceTime: antes(60_000),
    serverTime: antes(60_000),
    protocol: 'gt06',
    attributes: { sat: 12, ignition: false },
  };
}

function servico(devices: unknown[], positions: unknown[], imeis: string[]) {
  const prisma = {
    stockItem: { findMany: jest.fn().mockResolvedValue(imeis.map((imei) => ({ imei }))) },
  };
  const traccar = {
    getDevices: jest.fn().mockResolvedValue(devices),
    getPositions: jest.fn().mockResolvedValue(positions),
  };
  return new StockTraccarService(prisma as never, traccar as never, {} as never);
}

describe('StockTraccarService.connectivity — quem dorme não é offline', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(AGORA));
  afterEach(() => jest.restoreAllMocks());

  it('rastreador calado há 5 h (carro desligado) conta como ONLINE', async () => {
    const s = servico([device(1, 'A', 'unknown', antes(5 * 3600_000))], [], ['A']);
    const r = await s.connectivity('t1');
    expect(r).toMatchObject({ conectados: 1, desconectados: 0 });
    expect(r.statuses['A'].comunicando).toBe(true);
  });

  it('rastreador calado há 4 dias é OFFLINE — perdeu, arrancaram ou quebrou', async () => {
    const s = servico([device(1, 'A', 'unknown', antes(4 * 24 * 3600_000))], [], ['A']);
    const r = await s.connectivity('t1');
    expect(r).toMatchObject({ conectados: 0, desconectados: 1 });
    expect(r.statuses['A'].comunicando).toBe(false);
  });

  it('a fronteira é a mesma constante do resto do sistema (72 h)', async () => {
    const s = servico(
      [
        device(1, 'DENTRO', 'unknown', antes(SEM_CONTATO_MS - 1000)),
        device(2, 'FORA', 'unknown', antes(SEM_CONTATO_MS + 1000)),
      ],
      [],
      ['DENTRO', 'FORA'],
    );
    const r = await s.connectivity('t1');
    expect(r.statuses['DENTRO'].comunicando).toBe(true);
    expect(r.statuses['FORA'].comunicando).toBe(false);
    expect(SEM_CONTATO_MS).toBe(72 * 60 * 60 * 1000);
  });

  it('Traccar dizendo "offline" (TCP fechou) com contato de 1 min atrás NÃO é offline', async () => {
    const s = servico([device(1, 'A', 'offline', antes(60_000))], [], ['A']);
    const r = await s.connectivity('t1');
    expect(r.statuses['A'].comunicando).toBe(true);
  });

  it('"Sem sinal GPS" só conta quem está falando AGORA sem posição confiável', async () => {
    const s = servico(
      [
        // fala agora, sem posição nenhuma → sem sinal GPS
        device(1, 'AGORA_SEM_GPS', 'online', antes(30_000)),
        // dormindo há 5 h, sem posição fresca → é sono, não defeito de antena
        device(2, 'DORMINDO', 'unknown', antes(5 * 3600_000)),
        // fala agora com fix de 1 min → tudo certo
        device(3, 'OK', 'online', antes(30_000)),
      ],
      [posicaoFresca(3)],
      ['AGORA_SEM_GPS', 'DORMINDO', 'OK'],
    );
    const r = await s.connectivity('t1');
    expect(r.semGps).toBe(1);
    expect(r.statuses['AGORA_SEM_GPS'].gpsOk).toBe(false);
    expect(r.statuses['OK'].gpsOk).toBe(true);
    expect(r.conectados).toBe(3);
  });

  it('nunca falou é OFFLINE, não "vivo"', async () => {
    const s = servico([device(1, 'A', 'offline', null)], [], ['A']);
    const r = await s.connectivity('t1');
    expect(r.statuses['A'].comunicando).toBe(false);
    expect(r.desconectados).toBe(1);
  });
});
