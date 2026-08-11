import { assessComms } from './asset-comms';

const AGORA = new Date('2026-08-11T12:00:00.000Z');

/** Data a N minutos atrás de AGORA. */
function atras(minutos: number): Date {
  return new Date(AGORA.getTime() - minutos * 60 * 1000);
}

describe('assessComms', () => {
  it('trata ativo sem nenhum carimbo como NUNCA', () => {
    expect(assessComms(null, null, AGORA)).toEqual({
      state: 'NUNCA',
      gprsAgeMinutes: null,
      gpsAgeMinutes: null,
    });
  });

  it('considera OK quando GPRS e GPS são recentes', () => {
    const r = assessComms(atras(3), atras(3), AGORA);
    expect(r.state).toBe('OK');
    expect(r.gprsAgeMinutes).toBe(3);
    expect(r.gpsAgeMinutes).toBe(3);
  });

  it('segue OK com GPS de 5h — abaixo do limite de congelamento', () => {
    expect(assessComms(atras(10), atras(5 * 60), AGORA).state).toBe('OK');
  });

  it('acusa GPS_CONGELADO quando o chip fala e o GPS parou há 8h', () => {
    const r = assessComms(atras(2), atras(8 * 60), AGORA);
    expect(r.state).toBe('GPS_CONGELADO');
    expect(r.gpsAgeMinutes).toBe(480);
  });

  it('acusa GPS_CONGELADO no limite exato de 6h', () => {
    expect(assessComms(atras(1), atras(6 * 60), AGORA).state).toBe(
      'GPS_CONGELADO',
    );
  });

  it('acusa GPS_CONGELADO quando o device comunica mas nunca teve posição', () => {
    expect(assessComms(atras(5), null, AGORA).state).toBe('GPS_CONGELADO');
  });

  it('acusa GPS_CONGELADO mesmo com o GPRS já velho, desde que não esteja mudo', () => {
    // GPRS de 5h não é "vivo", mas ainda está longe das 24h: o que importa aqui
    // é que a posição está 10h atrasada em relação ao chip.
    expect(assessComms(atras(5 * 60), atras(10 * 60), AGORA).state).toBe(
      'GPS_CONGELADO',
    );
  });

  it('acusa MUDO quando nada chega há mais de 24h', () => {
    expect(assessComms(atras(30 * 60), atras(30 * 60), AGORA).state).toBe(
      'MUDO',
    );
  });

  it('acusa MUDO no limite exato de 24h', () => {
    expect(assessComms(atras(24 * 60), atras(24 * 60), AGORA).state).toBe(
      'MUDO',
    );
  });

  it('não chama de mudo o device que tem posição recente sem lastConnection', () => {
    // Histórico anterior à gravação de lastConnection: só a posição prova vida.
    expect(assessComms(null, atras(4), AGORA).state).toBe('OK');
  });

  it('não chama de mudo o device com GPRS recente e sem posição alguma', () => {
    expect(assessComms(atras(30), null, AGORA).state).toBe('GPS_CONGELADO');
  });

  it('nunca devolve idade negativa quando o carimbo vem do futuro', () => {
    const futuro = new Date(AGORA.getTime() + 5 * 60 * 1000);
    const r = assessComms(futuro, futuro, AGORA);
    expect(r.gprsAgeMinutes).toBe(0);
    expect(r.gpsAgeMinutes).toBe(0);
    expect(r.state).toBe('OK');
  });
});
