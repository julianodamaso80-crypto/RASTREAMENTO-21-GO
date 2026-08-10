import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import {
  ASSOCIATE_CONTROLLERS,
  AuthWorld,
  INTERNAL_CONTROLLERS,
  LEAK_PROBES,
  PROBES_SEM_GET,
  PUBLIC_CONTROLLERS,
  TECHNICIAN_CONTROLLERS,
} from './auth-worlds';

const MODULES_DIR = join(__dirname, '..', '..', 'modules');

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return entry.endsWith('.controller.ts') ? [full] : [];
  });
}

/**
 * Caminho do controller relativo a `src/modules/`, sempre com `/` — mesmo
 * formato usado como chave em `auth-worlds.ts`. `sep` é `\` no Windows e `/`
 * no Linux/CI; normalizar aqui é o que faz o spec passar nos dois.
 *
 * Ao contrário da versão anterior (que extraía o prefixo de `@Controller('...')`
 * por regex e descartava quem usa `@Controller()` sem argumento), aqui TODO
 * arquivo `*.controller.ts` vira uma chave — não existe caminho de descarte.
 */
function controllerPathOf(file: string): string {
  return relative(MODULES_DIR, file).split(sep).join('/');
}

const TODOS_OS_MUNDOS = [
  ...INTERNAL_CONTROLLERS,
  ...ASSOCIATE_CONTROLLERS,
  ...TECHNICIAN_CONTROLLERS,
  ...PUBLIC_CONTROLLERS,
];

/** Devolve o mundo do controller consultando as três listas explicitamente — nunca um valor padrão. */
function mundoDoController(controller: string): AuthWorld | null {
  if (INTERNAL_CONTROLLERS.includes(controller)) return 'internal';
  if (ASSOCIATE_CONTROLLERS.includes(controller)) return 'associate';
  if (TECHNICIAN_CONTROLLERS.includes(controller)) return 'technician';
  return null;
}

describe('mapa dos mundos de autenticação', () => {
  const controllers = controllerFiles(MODULES_DIR).map(controllerPathOf);

  it('todo controller está classificado em exatamente um mundo', () => {
    const naoClassificados = controllers.filter((c) => !TODOS_OS_MUNDOS.includes(c));

    expect(naoClassificados).toEqual([]);
  });

  it('nenhum controller aparece em mais de um mundo', () => {
    const vistos = new Map<string, number>();
    for (const c of TODOS_OS_MUNDOS) {
      vistos.set(c, (vistos.get(c) ?? 0) + 1);
    }
    const duplicados = [...vistos.entries()]
      .filter(([, n]) => n > 1)
      .map(([c]) => c);

    expect(duplicados).toEqual([]);
  });

  it('todo controller com autenticação tem sonda ou justificativa registrada', () => {
    const comAuth = [
      ...INTERNAL_CONTROLLERS,
      ...ASSOCIATE_CONTROLLERS,
      ...TECHNICIAN_CONTROLLERS,
    ];
    const cobertos = new Set([
      ...LEAK_PROBES.map((s) => s.controller),
      ...PROBES_SEM_GET,
    ]);
    const semCobertura = comAuth.filter((c) => !cobertos.has(c));

    expect(semCobertura).toEqual([]);
  });

  it('cada sonda aponta pro mundo do próprio controller', () => {
    const errados = LEAK_PROBES.filter((s) => s.world !== mundoDoController(s.controller)).map(
      (s) => `${s.controller} declarada como ${s.world}`,
    );

    expect(errados).toEqual([]);
  });

  it('toda sonda aponta pra um controller que existe em alguma das listas de mundo', () => {
    const inexistentes = LEAK_PROBES.filter((s) => mundoDoController(s.controller) === null).map(
      (s) => `${s.controller} (sonda: ${s.path})`,
    );

    expect(inexistentes).toEqual([]);
  });
});
