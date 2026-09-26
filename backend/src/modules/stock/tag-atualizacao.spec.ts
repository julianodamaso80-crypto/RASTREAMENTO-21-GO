import {
  CICLO_AUTOMATICO_MS,
  ESPERA_MANUAL_MS,
  estadoAtualizacaoTag,
} from './tag-atualizacao';

const AGORA = new Date('2026-09-16T18:00:00Z');
const antes = (ms: number) => new Date(AGORA.getTime() - ms);

describe('estadoAtualizacaoTag — a trava de 3 min da Rede', () => {
  it('TAG nunca atualizada pode atualizar agora', () => {
    expect(estadoAtualizacaoTag(null, AGORA)).toMatchObject({ pode: true, segundosRestantes: 0 });
  });

  it('2min59 ainda está travada, e diz quantos segundos faltam', () => {
    const r = estadoAtualizacaoTag(antes(2 * 60_000 + 59_000), AGORA);
    expect(r.pode).toBe(false);
    expect(r.segundosRestantes).toBe(1);
  });

  it('exatamente 3 min libera', () => {
    expect(estadoAtualizacaoTag(antes(ESPERA_MANUAL_MS), AGORA).pode).toBe(true);
  });

  it('3min01 libera', () => {
    expect(estadoAtualizacaoTag(antes(ESPERA_MANUAL_MS + 1000), AGORA).pode).toBe(true);
  });

  it('os números são os do aviso da Rede: 3 min manual, 15 min automático', () => {
    expect(ESPERA_MANUAL_MS).toBe(180_000);
    expect(CICLO_AUTOMATICO_MS).toBe(900_000);
  });
});
