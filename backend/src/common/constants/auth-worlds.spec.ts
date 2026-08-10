import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  ASSOCIATE_ROUTE_PREFIXES,
  INTERNAL_ROUTE_PREFIXES,
  LEAK_PROBES,
  PROBES_SEM_GET,
  PUBLIC_ROUTE_PREFIXES,
  TECHNICIAN_ROUTE_PREFIXES,
} from './auth-worlds';

const MODULES_DIR = join(__dirname, '..', '..', 'modules');

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return entry.endsWith('.controller.ts') ? [full] : [];
  });
}

function prefixOf(file: string): string | null {
  const match = readFileSync(file, 'utf8').match(/@Controller\(\s*'([^']*)'/);
  return match ? match[1] : null;
}

const TODOS_OS_MUNDOS = [
  ...INTERNAL_ROUTE_PREFIXES,
  ...ASSOCIATE_ROUTE_PREFIXES,
  ...TECHNICIAN_ROUTE_PREFIXES,
  ...PUBLIC_ROUTE_PREFIXES,
];

describe('mapa dos mundos de autenticação', () => {
  const prefixos = controllerFiles(MODULES_DIR)
    .map((file) => ({ file, prefix: prefixOf(file) }))
    .filter((c): c is { file: string; prefix: string } => c.prefix !== null);

  it('todo controller está classificado em exatamente um mundo', () => {
    const naoClassificados = prefixos
      .filter(({ prefix }) => !TODOS_OS_MUNDOS.includes(prefix))
      .map(({ prefix, file }) => `${prefix} (${file})`);

    expect(naoClassificados).toEqual([]);
  });

  it('nenhum prefixo aparece em mais de um mundo', () => {
    const vistos = new Map<string, number>();
    for (const p of TODOS_OS_MUNDOS) {
      vistos.set(p, (vistos.get(p) ?? 0) + 1);
    }
    const duplicados = [...vistos.entries()]
      .filter(([, n]) => n > 1)
      .map(([p]) => p);

    expect(duplicados).toEqual([]);
  });

  it('todo prefixo com autenticação tem sonda ou justificativa registrada', () => {
    const comAuth = [
      ...INTERNAL_ROUTE_PREFIXES,
      ...ASSOCIATE_ROUTE_PREFIXES,
      ...TECHNICIAN_ROUTE_PREFIXES,
    ];
    const cobertos = new Set([
      ...LEAK_PROBES.map((s) => s.prefix),
      ...PROBES_SEM_GET,
    ]);
    const semCobertura = comAuth.filter((p) => !cobertos.has(p));

    expect(semCobertura).toEqual([]);
  });

  it('cada sonda aponta pro mundo do próprio prefixo', () => {
    const mundoDe = (prefix: string) =>
      INTERNAL_ROUTE_PREFIXES.includes(prefix)
        ? 'internal'
        : ASSOCIATE_ROUTE_PREFIXES.includes(prefix)
          ? 'associate'
          : 'technician';

    const errados = LEAK_PROBES.filter((s) => s.world !== mundoDe(s.prefix)).map(
      (s) => `${s.prefix} declarado como ${s.world}`,
    );

    expect(errados).toEqual([]);
  });
});
