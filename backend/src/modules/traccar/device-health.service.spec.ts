import {
  DeviceHealthService,
  classificarEnergia,
  normalizarVolts,
} from './device-health.service';
import type { TraccarService } from './traccar.service';

/** Posição boa de referência — Sepetiba, RJ, com telemetria completa. */
function posicao(over: Record<string, unknown> = {}) {
  const attributes = {
    sat: 15,
    power: 12.63,
    ignition: false,
    ...((over.attributes as Record<string, unknown>) ?? {}),
  };
  return {
    id: 1,
    deviceId: 10,
    protocol: 'gt06',
    deviceTime: new Date().toISOString(),
    fixTime: new Date().toISOString(),
    serverTime: new Date().toISOString(),
    outdated: false,
    valid: true,
    latitude: -22.978052,
    longitude: -43.697688,
    altitude: 5,
    speed: 0,
    course: 225,
    address: 'Travessa São Cristóvão - Sepetiba, Rio de Janeiro - RJ',
    accuracy: 8,
    ...over,
    attributes,
  } as never;
}

function device(over: Record<string, unknown> = {}) {
  return {
    id: 10,
    name: '866557084669664',
    uniqueId: '866557084669664',
    status: 'online',
    lastUpdate: new Date().toISOString(),
    ...over,
  } as never;
}

function servico(traccar: Partial<TraccarService>) {
  return new DeviceHealthService(traccar as TraccarService);
}

describe('normalizarVolts', () => {
  it('mantém volts como vêm', () => {
    expect(normalizarVolts(12.63)).toBe(12.63);
  });

  it('converte milivolts em volts', () => {
    expect(normalizarVolts(12630)).toBe(12.63);
  });

  it('trata ausente, zero e lixo como null', () => {
    expect(normalizarVolts(undefined)).toBeNull();
    expect(normalizarVolts(0)).toBeNull();
    expect(normalizarVolts('12,6')).toBeNull();
  });
});

describe('classificarEnergia', () => {
  it('12,63 V é sistema 12V dentro da faixa', () => {
    expect(classificarEnergia(12.63)).toEqual({ sistema: '12V', faixa: 'ok' });
  });

  it('14,2 V (motor ligado, alternador carregando) segue ok', () => {
    expect(classificarEnergia(14.2)).toEqual({ sistema: '12V', faixa: 'ok' });
  });

  it('27,4 V é sistema 24V dentro da faixa', () => {
    expect(classificarEnergia(27.4)).toEqual({ sistema: '24V', faixa: 'ok' });
  });

  it('10,8 V é bateria fraca num sistema 12V', () => {
    expect(classificarEnergia(10.8)).toEqual({
      sistema: '12V',
      faixa: 'baixa',
    });
  });

  it('16 V é alto demais pra 12V — e ainda não é 24V', () => {
    expect(classificarEnergia(16)).toEqual({ sistema: '12V', faixa: 'alta' });
  });

  it('a fronteira dos 18 V separa os dois sistemas', () => {
    expect(classificarEnergia(18).sistema).toBe('12V');
    expect(classificarEnergia(18.1).sistema).toBe('24V');
  });

  it('sem voltagem reportada a faixa é ausente', () => {
    expect(classificarEnergia(null)).toEqual({
      sistema: null,
      faixa: 'ausente',
    });
  });
});

describe('DeviceHealthService.diagnose', () => {
  it('aprova rastreador comunicando, com GPS real, voltagem ok e ignição reportada', async () => {
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(device()),
      getPositions: jest.fn().mockResolvedValue([posicao()]),
    }).diagnose('866557084669664');

    expect(health.checkOk).toBe(true);
    expect(health.motivos).toEqual([]);
    expect(health.comunicando).toBe(true);
    expect(health.gps.ok).toBe(true);
    expect(health.energia).toMatchObject({
      volts: 12.63,
      sistema: '12V',
      faixa: 'ok',
    });
    expect(health.ignicao).toEqual({ reportada: true, ligada: false });
  });

  it('marca indisponível quando o servidor GPS está fora', async () => {
    const health = await servico({
      getDeviceByUniqueId: jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED')),
    }).diagnose('866557084669664');

    expect(health.indisponivel).toBe(true);
    expect(health.checkOk).toBe(false);
    expect(health.motivos[0]).toContain('servidor GPS indisponível');
  });

  it('avisa quando o IMEI nem existe no servidor GPS', async () => {
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(null),
    }).diagnose('866557084669664');

    expect(health.encontradoNoGps).toBe(false);
    expect(health.motivos[0]).toContain('ainda não apareceu');
  });

  it('cria o device sob demanda quando pedido', async () => {
    const createDevice = jest.fn().mockResolvedValue(device());
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(null),
      createDevice,
      getPositions: jest.fn().mockResolvedValue([posicao()]),
    }).diagnose('866557084669664', { ensureDevice: true });

    expect(createDevice).toHaveBeenCalledWith(
      '866557084669664',
      '866557084669664',
    );
    expect(health.checkOk).toBe(true);
  });

  it('reprova quando a posição veio por antena de celular', async () => {
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(device()),
      getPositions: jest
        .fn()
        .mockResolvedValue([posicao({ attributes: { approximate: true } })]),
    }).diagnose('866557084669664');

    expect(health.gps.ok).toBe(false);
    expect(health.checkOk).toBe(false);
    expect(health.motivos[0]).toContain('antena de celular');
  });

  it('reprova fix velho', async () => {
    const velho = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(device()),
      getPositions: jest
        .fn()
        .mockResolvedValue([posicao({ fixTime: velho, deviceTime: velho })]),
    }).diagnose('866557084669664');

    expect(health.gps.ok).toBe(false);
    expect(health.motivos.some((m) => m.includes('velha'))).toBe(true);
  });

  it('reprova quando o rastreador reporta menos de 4 satélites', async () => {
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(device()),
      getPositions: jest
        .fn()
        .mockResolvedValue([posicao({ attributes: { sat: 2 } })]),
    }).diagnose('866557084669664');

    expect(health.gps.ok).toBe(false);
    expect(health.motivos.some((m) => m.includes('satélite'))).toBe(true);
  });

  it('não reprova por satélite quando o protocolo simplesmente não reporta', async () => {
    const semSat = posicao();
    delete (semSat as unknown as { attributes: Record<string, unknown> })
      .attributes.sat;
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(device()),
      getPositions: jest.fn().mockResolvedValue([semSat]),
    }).diagnose('866557084669664');

    expect(health.gps.ok).toBe(true);
    expect(health.checkOk).toBe(true);
  });

  it('reprova quando o rastreador não reporta voltagem — fio de alimentação', async () => {
    const semPower = posicao();
    delete (semPower as unknown as { attributes: Record<string, unknown> })
      .attributes.power;
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(device()),
      getPositions: jest.fn().mockResolvedValue([semPower]),
    }).diagnose('866557084669664');

    expect(health.energia.faixa).toBe('ausente');
    expect(health.checkOk).toBe(false);
    expect(health.motivos.some((m) => m.includes('fio de alimentação'))).toBe(
      true,
    );
  });

  it('reprova quando o rastreador não informa a ignição — fio de ignição', async () => {
    const semIgnicao = posicao();
    delete (semIgnicao as unknown as { attributes: Record<string, unknown> })
      .attributes.ignition;
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(device()),
      getPositions: jest.fn().mockResolvedValue([semIgnicao]),
    }).diagnose('866557084669664');

    expect(health.ignicao.reportada).toBe(false);
    expect(health.checkOk).toBe(false);
    expect(health.motivos.some((m) => m.includes('fio de ignição'))).toBe(true);
  });

  it('ignição ligada não reprova nada — é o teste da chave', async () => {
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(device()),
      getPositions: jest
        .fn()
        .mockResolvedValue([
          posicao({ attributes: { ignition: true, power: 14.2 } }),
        ]),
    }).diagnose('866557084669664');

    expect(health.ignicao).toEqual({ reportada: true, ligada: true });
    expect(health.energia.faixa).toBe('ok');
    expect(health.checkOk).toBe(true);
  });

  it('acusa rastreador longe de quem está conferindo', async () => {
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(device()),
      getPositions: jest.fn().mockResolvedValue([posicao()]),
    }).diagnose('866557084669664', { refLat: -22.9, refLng: -43.55 });

    expect(health.distanceM).toBeGreaterThan(500);
    expect(health.checkOk).toBe(false);
    expect(health.motivos.some((m) => m.includes('de você'))).toBe(true);
  });

  it('chip mudo há mais de 5 minutos não conta como comunicando', async () => {
    const antigo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const health = await servico({
      getDeviceByUniqueId: jest
        .fn()
        .mockResolvedValue(device({ status: 'offline', lastUpdate: antigo })),
      getPositions: jest
        .fn()
        .mockResolvedValue([posicao({ fixTime: antigo, deviceTime: antigo })]),
    }).diagnose('866557084669664');

    expect(health.comunicando).toBe(false);
    expect(health.motivos[0]).toContain('chip está fora do ar');
  });

  it('avisa quando o equipamento existe no GPS mas nunca mandou posição', async () => {
    const health = await servico({
      getDeviceByUniqueId: jest.fn().mockResolvedValue(device()),
      getPositions: jest.fn().mockResolvedValue([]),
    }).diagnose('866557084669664');

    expect(health.encontradoNoGps).toBe(true);
    expect(health.jaReportou).toBe(false);
    expect(health.motivos[0]).toContain('ainda não mandou posição');
  });
});
