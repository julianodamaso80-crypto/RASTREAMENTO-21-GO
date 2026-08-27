import { buildDemoSightings, CASA, TRABALHO } from './demo-sightings';

describe('buildDemoSightings', () => {
  // 2026-08-20T03:00:00Z == 00:00 no horário de Brasília (-03).
  const base = new Date('2026-08-20T03:00:00.000Z');
  const dev = '11111111-1111-1111-1111-111111111111';
  const ten = '22222222-2222-2222-2222-222222222222';

  it('é determinística: mesma entrada, mesma saída', () => {
    expect(buildDemoSightings(dev, ten, base)).toEqual(
      buildDemoSightings(dev, ten, base),
    );
  });

  it('cobre 7 dias e gera centenas de pontos', () => {
    const s = buildDemoSightings(dev, ten, base);
    expect(s.length).toBeGreaterThan(200);
    const dias = new Set(
      s.map((p) =>
        new Date(p.seenAt.getTime() - 3 * 3600000).toISOString().slice(0, 10),
      ),
    );
    expect(dias.size).toBe(7);
  });

  it('todo ponto carrega accuracy > 0 e coordenada válida', () => {
    for (const p of buildDemoSightings(dev, ten, base)) {
      expect(p.accuracy).toBeGreaterThan(0);
      expect(p.scannerLat).toBeGreaterThanOrEqual(-90);
      expect(p.scannerLat).toBeLessThanOrEqual(90);
      expect(p.scannerLng).toBeGreaterThanOrEqual(-180);
      expect(p.scannerLng).toBeLessThanOrEqual(180);
      expect(p.seenAt).toBeInstanceOf(Date);
    }
  });

  it('concentra pontos noturnos (00-05h local) na CASA', () => {
    const s = buildDemoSightings(dev, ten, base);
    const noturnos = s.filter((p) => {
      const h = (p.seenAt.getUTCHours() - 3 + 24) % 24;
      return h >= 0 && h < 5;
    });
    expect(noturnos.length).toBeGreaterThan(0);
    const perto = noturnos.filter(
      (p) => Math.abs(p.scannerLat - CASA.lat) < 0.002,
    );
    expect(perto.length).toBeGreaterThan(noturnos.length * 0.8);
  });

  it('concentra pontos comerciais (10-16h local) no TRABALHO', () => {
    const s = buildDemoSightings(dev, ten, base);
    const comerciais = s.filter((p) => {
      const h = (p.seenAt.getUTCHours() - 3 + 24) % 24;
      return h >= 10 && h < 16;
    });
    expect(comerciais.length).toBeGreaterThan(0);
    const perto = comerciais.filter(
      (p) => Math.abs(p.scannerLat - TRABALHO.lat) < 0.002,
    );
    expect(perto.length).toBeGreaterThan(comerciais.length * 0.8);
  });

  it('hashedAdvKey é único por ponto (dedupe do service não colapsa a série)', () => {
    const s = buildDemoSightings(dev, ten, base);
    expect(new Set(s.map((p) => p.hashedAdvKey)).size).toBe(s.length);
  });
});
