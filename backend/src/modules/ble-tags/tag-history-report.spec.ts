import { BadRequestException } from '@nestjs/common';
import {
  buildTagHistoryReport,
  validarPeriodoTag,
  type AvistamentoTag,
} from './tag-history-report';

const base = Date.parse('2026-10-20T12:00:00Z');
const min = (n: number) => new Date(base + n * 60_000);

function av(
  minuto: number,
  lat: number,
  lng: number,
  extra: Partial<AvistamentoTag> = {},
): AvistamentoTag {
  return {
    seenAt: min(minuto),
    receivedAt: min(minuto + 13),
    latitude: lat,
    longitude: lng,
    accuracyM: 20,
    source: 'APPLE_FINDMY',
    ...extra,
  };
}

describe('buildTagHistoryReport', () => {
  it('junta avistamentos seguidos no mesmo lugar numa linha só, com de/até e quantidade', () => {
    const r = buildTagHistoryReport(
      [
        av(0, -22.9, -43.5),
        av(15, -22.90001, -43.50001),
        av(30, -22.9, -43.5),
        av(60, -22.95, -43.6),
      ],
      'basico',
    );
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ count: 3, time: min(0).toISOString(), untilTime: min(30).toISOString() });
    expect(r.rows[1]).toMatchObject({ count: 1, time: min(60).toISOString() });
    expect(r.totals).toMatchObject({ sightings: 4, places: 2 });
  });

  it('ordena por hora do avistamento, não pela ordem em que chegaram', () => {
    const r = buildTagHistoryReport(
      [av(60, -22.95, -43.6), av(0, -22.9, -43.5)],
      'basico',
    );
    expect(r.rows.map((l) => l.time)).toEqual([min(0).toISOString(), min(60).toISOString()]);
    expect(r.totals.firstSeen).toBe(min(0).toISOString());
    expect(r.totals.lastSeen).toBe(min(60).toISOString());
  });

  it('descarta coordenada inválida (0,0 e fora do mundo) e não conta como avistamento', () => {
    const r = buildTagHistoryReport(
      [av(0, 0, 0), av(5, 95, -43), av(10, -22.9, -43.5)],
      'basico',
    );
    expect(r.totals.sightings).toBe(1);
    expect(r.rows).toHaveLength(1);
  });

  it('avançado traz precisão, fonte e o atraso entre ver e saber', () => {
    const r = buildTagHistoryReport([av(0, -22.9, -43.5, { accuracyM: 82 })], 'avancado');
    expect(r.rows[0]).toMatchObject({
      accuracyM: 82,
      source: 'APPLE_FINDMY',
      delayMin: 13,
    });
  });

  it('básico não carrega os campos do avançado', () => {
    const r = buildTagHistoryReport([av(0, -22.9, -43.5)], 'basico');
    expect(r.rows[0]).not.toHaveProperty('delayMin');
    expect(r.rows[0]).not.toHaveProperty('source');
  });

  it('consolidado: um registro por dia de Brasília, com primeiro, último e onde foi visto por último', () => {
    // 20/10 23:30 em Brasília = 21/10 02:30 UTC
    const r = buildTagHistoryReport(
      [
        av(0, -22.9, -43.5), // 20/10 09:00 Brasília
        av(120, -22.91, -43.51), // 20/10 11:00
        { ...av(0, -22.8, -43.4), seenAt: new Date('2026-10-21T02:30:00Z'), receivedAt: new Date('2026-10-21T02:40:00Z') },
      ],
      'consolidado',
    );
    expect(r.rows).toHaveLength(0);
    expect(r.days.map((d) => [d.date, d.count])).toEqual([
      ['2026-10-20', 3],
    ]);
  });

  it('consolidado separa dias diferentes e usa o último avistamento do dia como local', () => {
    const r = buildTagHistoryReport(
      [
        av(0, -22.9, -43.5),
        av(120, -22.91, -43.51),
        { ...av(0, -22.8, -43.4), seenAt: new Date('2026-10-21T15:00:00Z'), receivedAt: new Date('2026-10-21T15:10:00Z') },
      ],
      'consolidado',
    );
    expect(r.days).toHaveLength(2);
    expect(r.days[0]).toMatchObject({ date: '2026-10-20', count: 2, lat: -22.91, lng: -43.51 });
    expect(r.days[1]).toMatchObject({ date: '2026-10-21', count: 1 });
    expect(r.totals.days).toBe(2);
  });

  it('nunca devolve distância, velocidade ou ignição (a TAG não sabe disso)', () => {
    const r = buildTagHistoryReport([av(0, -22.9, -43.5), av(60, -22.95, -43.6)], 'avancado');
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/distance|speed|ignition|km/i);
  });

  it('período sem avistamentos devolve tudo vazio, sem estourar', () => {
    const r = buildTagHistoryReport([], 'basico');
    expect(r.rows).toEqual([]);
    expect(r.totals).toMatchObject({ sightings: 0, places: 0, days: 0, firstSeen: null, lastSeen: null });
  });
});

describe('validarPeriodoTag', () => {
  const agora = Date.parse('2026-10-24T12:00:00Z');
  const ok = (from: string, to: string, tipo = 'basico') =>
    validarPeriodoTag(from, to, tipo, 90, agora);

  it('aceita período válido', () => {
    expect(() => ok('2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z')).not.toThrow();
  });
  it('recusa tipo desconhecido, data inválida e início maior que fim', () => {
    expect(() => ok('2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z', 'x')).toThrow(BadRequestException);
    expect(() => ok('nada', '2026-10-21T00:00:00Z')).toThrow(/Período inválido/);
    expect(() => ok('2026-10-22T00:00:00Z', '2026-10-21T00:00:00Z')).toThrow(/Inicial não pode ser maior/);
  });
  it('recusa começar antes do que o histórico guarda', () => {
    expect(() => ok('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toThrow(/últimos 90 dias/);
  });
  it('lista (básico/avançado) vai até 30 dias; consolidado até 90', () => {
    expect(() => ok('2026-09-01T00:00:00Z', '2026-10-05T00:00:00Z')).toThrow(/não pode ser maior que 30 dias/);
    expect(() => ok('2026-08-01T00:00:00Z', '2026-10-20T00:00:00Z', 'consolidado')).not.toThrow();
  });
});
