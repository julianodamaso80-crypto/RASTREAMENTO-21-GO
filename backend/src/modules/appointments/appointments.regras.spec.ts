import {
  exigeMotivoManutencao,
  exigeObservacao,
  numeroOs,
  periodoDoTurno,
  timingDaExecucao,
  turnoDoPeriodo,
} from './appointments.regras';

describe('regras da agenda', () => {
  describe('periodoDoTurno', () => {
    it('manhã vai das 8h às 12h', () => {
      const { inicio, fim } = periodoDoTurno('2026-09-15', 'MORNING');
      expect(inicio.getHours()).toBe(8);
      expect(fim.getHours()).toBe(12);
      expect(inicio.getDate()).toBe(15);
    });

    it('dia todo vai das 8h às 18h', () => {
      const { inicio, fim } = periodoDoTurno('2026-09-15', 'ALL_DAY');
      expect(inicio.getHours()).toBe(8);
      expect(fim.getHours()).toBe(18);
    });

    it('customizável usa as horas informadas', () => {
      const { inicio, fim } = periodoDoTurno('2026-09-15', 'CUSTOM', '09:30', '11:45');
      expect(inicio.getHours()).toBe(9);
      expect(inicio.getMinutes()).toBe(30);
      expect(fim.getHours()).toBe(11);
      expect(fim.getMinutes()).toBe(45);
    });

    it('customizável sem hora não passa', () => {
      expect(() => periodoDoTurno('2026-09-15', 'CUSTOM')).toThrow(/hora de início/i);
    });

    it('fim antes do início não passa', () => {
      expect(() => periodoDoTurno('2026-09-15', 'CUSTOM', '14:00', '09:00')).toThrow(
        /não pode ser anterior/i,
      );
    });
  });

  describe('turnoDoPeriodo', () => {
    it('reconhece a janela da tarde', () => {
      const inicio = new Date(2026, 8, 15, 13, 0);
      const fim = new Date(2026, 8, 15, 18, 0);
      expect(turnoDoPeriodo(inicio, fim)).toBe('AFTERNOON');
    });

    it('horário fora das janelas é customizável', () => {
      const inicio = new Date(2026, 8, 15, 9, 30);
      const fim = new Date(2026, 8, 15, 11, 45);
      expect(turnoDoPeriodo(inicio, fim)).toBe('CUSTOM');
    });

    it('ida e volta preservam o turno', () => {
      const { inicio, fim } = periodoDoTurno('2026-09-15', 'NIGHT');
      expect(turnoDoPeriodo(inicio, fim)).toBe('NIGHT');
    });
  });

  describe('numeroOs', () => {
    it('usa o formato AAAAMMDD/sequencial', () => {
      expect(numeroOs(new Date(2026, 8, 2), 24014)).toBe('20260902/24014');
    });

    it('preenche mês e dia com zero à esquerda', () => {
      expect(numeroOs(new Date(2026, 0, 5), 1)).toBe('20260105/1');
    });
  });

  it('só manutenção exige motivo', () => {
    expect(exigeMotivoManutencao('MAINTENANCE')).toBe(true);
    expect(exigeMotivoManutencao('INSTALLATION')).toBe(false);
    expect(exigeMotivoManutencao('REMOVAL')).toBe(false);
  });

  describe('exigeObservacao', () => {
    it('cancelamento e visita frustrada exigem', () => {
      expect(exigeObservacao('CANCELED')).toBe(true);
      expect(exigeObservacao('CANCELED_BY_CLIENT')).toBe(true);
      expect(exigeObservacao('FRUSTRATED_CLIENT')).toBe(true);
      expect(exigeObservacao('FRUSTRATED_TECHNICIAN')).toBe(true);
    });

    it('concluído não exige', () => {
      expect(exigeObservacao('COMPLETED')).toBe(false);
      expect(exigeObservacao('SCHEDULED')).toBe(false);
    });
  });

  describe('timingDaExecucao', () => {
    const inicio = new Date(2026, 8, 15, 8, 0);
    const fim = new Date(2026, 8, 15, 12, 0);

    it('dentro da janela é no horário', () => {
      expect(timingDaExecucao(inicio, fim, new Date(2026, 8, 15, 10, 0))).toBe('ON_TIME');
    });

    it('meia hora depois ainda é no horário', () => {
      expect(timingDaExecucao(inicio, fim, new Date(2026, 8, 15, 12, 25))).toBe('ON_TIME');
    });

    it('uma hora depois do fim é atraso', () => {
      expect(timingDaExecucao(inicio, fim, new Date(2026, 8, 15, 13, 0))).toBe(
        'TECHNICIAN_LATE',
      );
    });

    it('bem antes no mesmo dia é técnico adiantado', () => {
      expect(timingDaExecucao(inicio, fim, new Date(2026, 8, 15, 6, 0))).toBe(
        'TECHNICIAN_EARLY',
      );
    });

    it('em dia anterior é serviço antecipado', () => {
      expect(timingDaExecucao(inicio, fim, new Date(2026, 8, 14, 15, 0))).toBe(
        'ANTICIPATED_BY_TECHNICIAN',
      );
    });
  });
});
