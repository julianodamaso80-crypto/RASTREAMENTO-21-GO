/**
 * Histórico por dia, no molde do "Viagens e históricos" da RedeVeiculos:
 * viagens do dia, tempo de parada entre uma e outra, trajeto de cada viagem.
 *
 * O que este teste segura:
 * 1. Posição reprovada pelo assessPosition (LBS, fix inválido) NUNCA entra no
 *    trajeto — regra dura do projeto, vale pro histórico de rota.
 * 2. Rastreador parado repetindo o mesmo fix (heartbeat) não vira viagem.
 * 3. A parada entre duas viagens é o intervalo entre a última posição de uma
 *    e a primeira da seguinte.
 * 4. "Dia" é o dia de Brasília (UTC−3), não o dia UTC.
 */
import { buildJourney, diaEmBrasilia } from './journey';
import type { TraccarPosition } from '../traccar/traccar.service';

const NOS = 1 / 1.852; // 1 km/h em nós

function pos(
  iso: string,
  lat: number,
  lng: number,
  kmh: number,
  extra: Partial<TraccarPosition> = {},
): TraccarPosition {
  return {
    id: 0,
    deviceId: 1,
    protocol: 'gt06',
    deviceTime: iso,
    fixTime: iso,
    serverTime: iso,
    outdated: false,
    valid: true,
    latitude: lat,
    longitude: lng,
    altitude: 0,
    speed: kmh * NOS,
    course: 0,
    address: '',
    accuracy: 0,
    attributes: { ignition: kmh > 0 },
    ...extra,
  } as TraccarPosition;
}

describe('diaEmBrasilia', () => {
  it('2026-10-08 em Brasília vai de 03:00Z a 03:00Z do dia seguinte', () => {
    expect(diaEmBrasilia('2026-10-08')).toEqual({
      from: '2026-10-08T03:00:00.000Z',
      to: '2026-10-09T03:00:00.000Z',
    });
  });

  it('rejeita data fora do formato', () => {
    expect(() => diaEmBrasilia('08/10/2026')).toThrow();
    expect(() => diaEmBrasilia('2026-13-40')).toThrow();
  });
});

describe('buildJourney', () => {
  const viagemA = [
    pos('2026-10-08T12:00:00Z', -22.9, -43.2, 30),
    pos('2026-10-08T12:05:00Z', -22.91, -43.21, 50),
    pos('2026-10-08T12:10:00Z', -22.92, -43.22, 40),
  ];
  const parado = [
    pos('2026-10-08T12:12:00Z', -22.92, -43.22, 0),
    pos('2026-10-08T12:40:00Z', -22.92, -43.22, 0),
  ];
  const viagemB = [
    pos('2026-10-08T13:00:00Z', -22.92, -43.22, 20),
    pos('2026-10-08T13:08:00Z', -22.95, -43.25, 60),
  ];

  it('separa duas viagens e mede a parada entre elas', () => {
    const j = buildJourney([...viagemA, ...parado, ...viagemB]);
    expect(j).toHaveLength(2);
    expect(j[0].startTime).toBe('2026-10-08T12:00:00Z');
    expect(j[0].endTime).toBe('2026-10-08T12:10:00Z');
    expect(j[0].path).toHaveLength(3);
    // da última posição em movimento (12:10) à primeira da próxima (13:00)
    expect(j[0].stopAfterMin).toBe(50);
    expect(j[1].stopAfterMin).toBeNull();
  });

  it('traz velocidade máxima e média em km/h e o trajeto com hora e ignição', () => {
    const [v] = buildJourney(viagemA);
    expect(v.maxSpeed).toBe(50);
    expect(v.avgSpeed).toBe(40);
    expect(v.path[1]).toEqual({
      time: '2026-10-08T12:05:00Z',
      lat: -22.91,
      lng: -43.21,
      speed: 50,
      ignition: true,
    });
    expect(v.distanceKm).toBeGreaterThan(0);
    expect(v.durationMin).toBe(10);
  });

  it('descarta posição LBS e fix inválido do trajeto', () => {
    const lixo = pos('2026-10-08T12:07:00Z', -23.5, -46.6, 80, {
      valid: false,
    });
    const lbs = pos('2026-10-08T12:08:00Z', -23.6, -46.7, 80, {
      attributes: { approximate: true } as never,
    });
    const [v] = buildJourney([viagemA[0], viagemA[1], lixo, lbs, viagemA[2]]);
    expect(v.path.map((p) => p.lat)).toEqual([-22.9, -22.91, -22.92]);
    expect(v.maxSpeed).toBe(50);
  });

  it('rastreador repetindo o mesmo fix parado não gera viagem', () => {
    const heartbeat = Array.from({ length: 50 }, (_, i) =>
      pos(
        new Date(Date.parse('2026-10-08T10:00:00Z') + i * 60000).toISOString(),
        -22.8,
        -43.3,
        0,
      ),
    );
    expect(buildJourney(heartbeat)).toEqual([]);
  });

  it('sem posições, sem viagens', () => {
    expect(buildJourney([])).toEqual([]);
  });
});
