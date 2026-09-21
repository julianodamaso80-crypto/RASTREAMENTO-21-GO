import {
  casaBusca,
  fatiaCombinada,
  podeVerTag,
  umPorVeiculo,
  vinculoAparece,
} from './clients-tags';
import { Role } from '.prisma/client';

describe('podeVerTag', () => {
  it('só perfis internos; CLIENT nunca', () => {
    expect(podeVerTag(Role.SUPER_ADMIN)).toBe(true);
    expect(podeVerTag(Role.OPERATOR)).toBe(true);
    expect(podeVerTag(Role.VIEWER)).toBe(true);
    expect(podeVerTag('CLIENT')).toBe(false);
    expect(podeVerTag(undefined)).toBe(false);
  });
});

describe('vinculoAparece', () => {
  it('só com associado ATIVO no SGA agora', () => {
    expect(vinculoAparece({ origin: 'REDE', verdict: 'CONFIRMADA' }, 'INATIVO', true)).toBe(false);
    expect(vinculoAparece({ origin: 'REDE', verdict: 'CONFIRMADA' }, null, true)).toBe(false);
  });

  // Regra do dono (21/09/2026): ativo no SGA + vinculado + rastreável = cliente ativo.
  it('da Rede aparece quando a TAG é rastreável (tem posição nossa)', () => {
    expect(vinculoAparece({ origin: 'REDE', verdict: 'AGUARDANDO_PROVA' }, 'ATIVO', true)).toBe(true);
    expect(vinculoAparece({ origin: 'REDE', verdict: 'CONFIRMADA' }, 'ATIVO', true)).toBe(true);
  });

  it('da Rede sem nenhuma posição nossa ainda não aparece', () => {
    expect(vinculoAparece({ origin: 'REDE', verdict: 'AGUARDANDO_PROVA' }, 'ATIVO', false)).toBe(false);
  });

  it('posição que contradiz o carro nunca aparece', () => {
    expect(vinculoAparece({ origin: 'REDE', verdict: 'DIVERGENTE' }, 'ATIVO', true)).toBe(false);
  });

  it('vinculado no Estoque aparece na hora, menos se a posição contradisser', () => {
    expect(vinculoAparece({ origin: 'ESTOQUE', verdict: 'AGUARDANDO_PROVA' }, 'ATIVO', false)).toBe(true);
    expect(vinculoAparece({ origin: 'ESTOQUE', verdict: 'DIVERGENTE' }, 'ATIVO', true)).toBe(false);
  });
});

describe('umPorVeiculo — carro com duas TAGs na Rede vira um card só', () => {
  const item = (serialNumber: string, codigo: string | null, plate = 'SSA5I19') => ({
    vinculo: { serialNumber, plate },
    sga: codigo ? { hinovaVehicleCode: codigo } : null,
  });

  it('fica a TAG que tem posição', () => {
    const r = umPorVeiculo([item('A', '37985'), item('B', '37985')], new Set(['B']));
    expect(r.map((x) => x.vinculo.serialNumber)).toEqual(['B']);
  });

  it('empate: fica a primeira', () => {
    const r = umPorVeiculo([item('A', '1'), item('B', '1')], new Set(['A', 'B']));
    expect(r.map((x) => x.vinculo.serialNumber)).toEqual(['A']);
  });

  it('sem código do SGA agrupa pela placa; veículos diferentes não se juntam', () => {
    const r = umPorVeiculo(
      [item('A', null, 'AAA1A11'), item('B', null, 'AAA1A11'), item('C', '9')],
      new Set(),
    );
    expect(r.map((x) => x.vinculo.serialNumber)).toEqual(['A', 'C']);
  });
});

describe('fatiaCombinada — veículos primeiro, TAGs depois', () => {
  it('página só de veículos', () => {
    expect(fatiaCombinada(100, 50, 1, 20)).toEqual({ skipVeiculos: 0, takeVeiculos: 20, inicioTag: 0, fimTag: 0 });
  });
  it('página que cruza a fronteira pega o resto dos veículos e o começo das TAGs', () => {
    expect(fatiaCombinada(25, 50, 2, 20)).toEqual({ skipVeiculos: 20, takeVeiculos: 5, inicioTag: 0, fimTag: 15 });
  });
  it('página só de TAGs', () => {
    expect(fatiaCombinada(25, 50, 3, 20)).toEqual({ skipVeiculos: 25, takeVeiculos: 0, inicioTag: 15, fimTag: 35 });
  });
});

describe('casaBusca', () => {
  const item = { plate: 'ABC1D23', chassi: '9C2KC', associateName: 'João Silva', associateCpf: '12345678901', serialNumber: '808092605072173' };
  it('vazio casa com tudo', () => expect(casaBusca(item, '')).toBe(true));
  it('placa com ou sem hífen', () => {
    expect(casaBusca(item, 'abc1d23')).toBe(true);
    expect(casaBusca(item, 'ABC-1D23')).toBe(true);
  });
  it('nome, cpf e número da TAG', () => {
    expect(casaBusca(item, 'joão')).toBe(true);
    expect(casaBusca(item, '123456')).toBe(true);
    expect(casaBusca(item, '808092')).toBe(true);
  });
  it('não casa o que não bate', () => expect(casaBusca(item, 'XYZ9Z99')).toBe(false));
});
