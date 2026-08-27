import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Todo model do schema precisa ter getter no PrismaService.
 *
 * O PrismaService não repassa o cliente inteiro: ele expõe um getter por
 * model, para poder aplicar soft delete em uns e não em outros. A consequência
 * é que **model novo sem getter fica invisível** — e o defeito é silencioso.
 *
 * Foi o que aconteceu com `RdvTag` em 27/08/2026: o model existia, a migration
 * tinha rodado, 11 mil linhas estavam no banco, o Prisma Client tinha o
 * modelo gerado... e `this.prisma.rdvTag` era `undefined`. O código fazia
 * `if (!this.rdvTagModel) return []`, então nada quebrou: a aba TAGs Ativas
 * abriu em produção mostrando **zero** TAG ativa, com 8.669 no banco.
 *
 * Nenhum teste pegou porque todos passavam um Prisma dublê, onde o model
 * sempre existe. Só o schema real revela a falta.
 */
describe('PrismaService expõe todo model do schema', () => {
  const raiz = join(__dirname, '..', '..', '..');
  const schema = readFileSync(join(raiz, 'prisma', 'schema.prisma'), 'utf-8');
  const servico = readFileSync(
    join(__dirname, 'prisma.service.ts'),
    'utf-8',
  );

  /** `model RdvTag {` -> `rdvTag` (o nome que o Prisma Client usa). */
  const modelsDoSchema = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)]
    .map((m) => m[1])
    .map((nome) => nome.charAt(0).toLowerCase() + nome.slice(1));

  const gettersDoServico = new Set(
    [...servico.matchAll(/^\s{2}get\s+(\w+)\s*\(\)/gm)].map((m) => m[1]),
  );

  it('encontra os models do schema (o regex não silenciou)', () => {
    expect(modelsDoSchema.length).toBeGreaterThan(20);
    expect(modelsDoSchema).toContain('rdvTag');
    expect(modelsDoSchema).toContain('sgaVehicle');
  });

  it('encontra os getters do serviço (o regex não silenciou)', () => {
    expect(gettersDoServico.size).toBeGreaterThan(20);
    expect(gettersDoServico.has('sgaVehicle')).toBe(true);
  });

  it('nenhum model do schema ficou sem getter', () => {
    const semGetter = modelsDoSchema.filter((m) => !gettersDoServico.has(m));

    expect(semGetter).toEqual([]);
  });
});
