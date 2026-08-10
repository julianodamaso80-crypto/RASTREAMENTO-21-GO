import {
  ASSOCIATE_TOKEN_KEY,
  INTERNAL_TOKEN_KEY,
  resolveBootWorld,
} from './session-keys';

describe('resolveBootWorld', () => {
  it('só token de associado abre o mundo do associado', () => {
    expect(resolveBootWorld('tok', null)).toBe('associate');
  });

  it('só token interno abre o mundo interno', () => {
    expect(resolveBootWorld(null, 'tok')).toBe('internal');
  });

  it('nenhum token cai no login', () => {
    expect(resolveBootWorld(null, null)).toBe('none');
  });

  it('os dois presentes é estado impossível: cai no login (fail closed)', () => {
    expect(resolveBootWorld('a', 'b')).toBe('none');
  });

  it('as chaves dos dois mundos são diferentes', () => {
    expect(ASSOCIATE_TOKEN_KEY).not.toBe(INTERNAL_TOKEN_KEY);
  });
});
