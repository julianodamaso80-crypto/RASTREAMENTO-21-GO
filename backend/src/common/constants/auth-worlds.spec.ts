import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import {
  ASSOCIATE_CONTROLLERS,
  AuthWorld,
  INTERNAL_CONTROLLERS,
  LEAK_PROBES,
  MULTI_WORLD_GATEWAYS,
  PROBES_SEM_GET,
  PUBLIC_CONTROLLERS,
  TECHNICIAN_CONTROLLERS,
} from './auth-worlds';

const MODULES_DIR = join(__dirname, '..', '..', 'modules');

/**
 * Varre por SUFIXO de arquivo. `*.gateway.ts` entra junto com
 * `*.controller.ts` porque o WebSocket é uma porta de entrada autenticada
 * igual a uma rota HTTP — e, ao contrário do controller, é a única em que os
 * três mundos chegam pelo mesmo canal. Enquanto a varredura olhava só
 * controller, o gateway podia colocar qualquer token na sala do tenant sem
 * nenhuma asserção acusar.
 */
function arquivosComSufixo(dir: string, sufixo: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return arquivosComSufixo(full, sufixo);
    return entry.endsWith(sufixo) ? [full] : [];
  });
}

function controllerFiles(dir: string): string[] {
  return arquivosComSufixo(dir, '.controller.ts');
}

function gatewayFiles(dir: string): string[] {
  return arquivosComSufixo(dir, '.gateway.ts');
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

/** Tudo que é porta de entrada classificada: controllers + gateways. */
const TODOS_OS_ARQUIVOS_CLASSIFICADOS = [
  ...TODOS_OS_MUNDOS,
  ...MULTI_WORLD_GATEWAYS,
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
  const gateways = gatewayFiles(MODULES_DIR).map(controllerPathOf);

  it('todo controller está classificado em exatamente um mundo', () => {
    const naoClassificados = controllers.filter(
      (c) => !TODOS_OS_MUNDOS.includes(c),
    );

    expect(naoClassificados).toEqual([]);
  });

  it('todo gateway está classificado — nenhum socket fica fora do mapa', () => {
    const naoClassificados = gateways.filter(
      (g) => !TODOS_OS_ARQUIVOS_CLASSIFICADOS.includes(g),
    );

    expect(naoClassificados).toEqual([]);
  });

  it('todo gateway multi-mundo roteia explicitamente por type e conhece os dois segredos', () => {
    // Não basta estar na lista: o arquivo tem que provar que escolhe o segredo
    // pelo `type` do payload. Se alguém voltar pro `verify` genérico com
    // `jwt.secret`, o token do associado (assinado com `jwt.associateSecret`)
    // para de verificar e o app publicado perde o tempo real na hora.
    const semRoteamento = MULTI_WORLD_GATEWAYS.filter((g) => {
      const fonte = readFileSync(join(MODULES_DIR, g), 'utf8');
      return (
        !fonte.includes('payload.type') ||
        !fonte.includes('jwt.associateSecret')
      );
    });

    expect(semRoteamento).toEqual([]);
  });

  it('nenhum controller ou gateway aparece em mais de uma lista', () => {
    const vistos = new Map<string, number>();
    for (const c of TODOS_OS_ARQUIVOS_CLASSIFICADOS) {
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
    const errados = LEAK_PROBES.filter(
      (s) => s.world !== mundoDoController(s.controller),
    ).map((s) => `${s.controller} declarada como ${s.world}`);

    expect(errados).toEqual([]);
  });

  it('toda sonda aponta pra um controller que existe em alguma das listas de mundo', () => {
    const inexistentes = LEAK_PROBES.filter(
      (s) => mundoDoController(s.controller) === null,
    ).map((s) => `${s.controller} (sonda: ${s.path})`);

    expect(inexistentes).toEqual([]);
  });
});
