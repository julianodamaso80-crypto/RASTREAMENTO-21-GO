/**
 * Aba "Consultar" do histórico, no molde da Rede (colunas medidas em 09/10/2026):
 * - básico: Data/Hora, Latitude, Longitude, Km/h, Ignição, Evento, Distância
 * - avançado: básico + GPRS, GPS e Direção
 * - consolidado: um registro por dia com a velocidade máxima
 * Totais: ignição ligada, ignição desligada e distância percorrida.
 */
import { BadRequestException } from '@nestjs/common';
import {
  buildHistoryReport,
  direcaoCardeal,
  validarPeriodo,
} from './history-report';
import type { TraccarPosition } from '../traccar/traccar.service';

const NOS = 1 / 1.852;

function pos(
  iso: string,
  lat: number,
  lng: number,
  kmh: number,
  ignition: boolean,
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
    course: 90,
    address: '',
    accuracy: 0,
    attributes: { ignition },
    ...extra,
  } as TraccarPosition;
}

describe('direcaoCardeal', () => {
  it('converte o rumo em ponto cardeal', () => {
    expect(direcaoCardeal(0)).toBe('Norte');
    expect(direcaoCardeal(90)).toBe('Leste');
    expect(direcaoCardeal(135)).toBe('Sudeste');
    expect(direcaoCardeal(359)).toBe('Norte');
  });
});

describe('validarPeriodo', () => {
  const agora = Date.parse('2026-10-09T15:00:00Z');
  it('aceita período dentro do teto', () => {
    expect(() =>
      validarPeriodo('2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z', 'basico', 31, agora),
    ).not.toThrow();
  });
  it('recusa início depois do fim e período fora da janela', () => {
    expect(() =>
      validarPeriodo('2026-10-09T10:00:00Z', '2026-10-09T09:00:00Z', 'basico', 31, agora),
    ).toThrow(BadRequestException);
    expect(() =>
      validarPeriodo('2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z', 'basico', 31, agora),
    ).toThrow(BadRequestException);
  });
  it('básico e avançado aceitam até 7 dias; consolidado até 31', () => {
    expect(() =>
      validarPeriodo('2026-10-01T00:00:00Z', '2026-10-09T00:00:00Z', 'avancado', 31, agora),
    ).toThrow(BadRequestException);
    expect(() =>
      validarPeriodo('2026-09-10T00:00:00Z', '2026-10-09T00:00:00Z', 'consolidado', 31, agora),
    ).not.toThrow();
  });
  it('recusa tipo desconhecido', () => {
    expect(() =>
      validarPeriodo('2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z', 'xpto', 31, agora),
    ).toThrow(BadRequestException);
  });
});

describe('buildHistoryReport', () => {
  const dia = [
    pos('2026-10-08T12:00:00Z', -22.9, -43.2, 0, false),
    pos('2026-10-08T12:01:00Z', -22.9, -43.2, 0, false), // repetida parada: some
    pos('2026-10-08T12:10:00Z', -22.91, -43.21, 40, true),
    pos('2026-10-08T12:20:00Z', -22.93, -43.23, 60, true),
    pos('2026-10-08T12:30:00Z', -22.93, -43.23, 0, false),
  ];

  it('básico: tira a repetição parada e calcula a distância de cada linha', () => {
    const r = buildHistoryReport(dia, 'basico');
    expect(r.rows.map((x) => x.time)).toEqual([
      '2026-10-08T12:00:00Z',
      '2026-10-08T12:10:00Z',
      '2026-10-08T12:20:00Z',
      '2026-10-08T12:30:00Z',
    ]);
    expect(r.rows[0].distanceM).toBeNull();
    expect(r.rows[1].distanceM).toBeGreaterThan(1000);
    expect(r.rows[3].distanceM).toBe(0);
    expect(r.rows[2].speed).toBe(60);
  });

  it('totais: distância somada e tempo por estado da ignição', () => {
    const r = buildHistoryReport(dia, 'basico');
    expect(r.totals.distanceKm).toBeGreaterThan(3);
    // 12:00→12:10 desligada (10) + 12:20→12:30 ligada vira 10; 12:10→12:20 ligada (10)
    expect(r.totals.ignitionOffMin).toBe(10);
    expect(r.totals.ignitionOnMin).toBe(20);
  });

  it('avançado traz GPRS, GPS e direção por extenso', () => {
    const r = buildHistoryReport(dia, 'avancado');
    expect(r.rows[1].gprs).toBe('2026-10-08T12:10:00Z');
    expect(r.rows[1].gps).toBe('2026-10-08T12:10:00Z');
    expect(r.rows[1].direction).toBe('Leste');
  });

  it('básico não carrega os campos do avançado', () => {
    const r = buildHistoryReport(dia, 'basico');
    expect(r.rows[1]).not.toHaveProperty('gprs');
  });

  it('descarta posição reprovada (fix inválido) do relatório', () => {
    const ruim = pos('2026-10-08T12:15:00Z', -23.5, -46.6, 90, true, { valid: false });
    const r = buildHistoryReport([...dia, ruim], 'basico');
    expect(r.rows.some((x) => x.lat === -23.5)).toBe(false);
  });

  it('consolidado: um registro por dia de Brasília com a velocidade máxima', () => {
    const doisDias = [
      ...dia,
      pos('2026-10-09T01:00:00Z', -22.95, -43.25, 80, true), // 22h de 08/10 em Brasília
      pos('2026-10-09T04:00:00Z', -22.96, -43.26, 30, true), // 01h de 09/10 em Brasília
    ];
    const r = buildHistoryReport(doisDias, 'consolidado');
    expect(r.days).toEqual([
      { date: '2026-10-08', maxSpeed: 80, lat: -22.95, lng: -43.25 },
      { date: '2026-10-09', maxSpeed: 30, lat: -22.96, lng: -43.26 },
    ]);
    expect(r.rows).toEqual([]);
  });

  it('sem posições devolve relatório vazio e totais zerados', () => {
    const r = buildHistoryReport([], 'basico');
    expect(r.rows).toEqual([]);
    expect(r.totals).toEqual({ distanceKm: 0, ignitionOnMin: 0, ignitionOffMin: 0 });
  });
});
