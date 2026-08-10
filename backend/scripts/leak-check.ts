/**
 * Prova, contra a API DE VERDADE, que nenhum token cruza a fronteira dos três
 * mundos de autenticação. Roda antes de cada deploy.
 *
 *   npx ts-node scripts/leak-check.ts
 *
 * Variáveis:
 *   LEAK_API_URL     base da API (default https://api.trackgo.site/api/v1)
 *   LEAK_CPF         CPF de um associado de teste
 *   LEAK_CPF_PASS    senha dele
 *   LEAK_EMAIL       e-mail de um usuário interno de teste
 *   LEAK_EMAIL_PASS  senha dele
 */
import { LEAK_PROBES } from '../src/common/constants/auth-worlds';

const API = process.env.LEAK_API_URL || 'https://api.trackgo.site/api/v1';

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Falta a variável ${nome}.`);
    process.exit(1);
  }
  return valor;
}

async function login(path: string, body: unknown): Promise<string> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  const token = json?.data?.accessToken ?? json?.accessToken;
  if (!token) {
    console.error(`Login falhou em ${path}: HTTP ${res.status}`);
    process.exit(1);
  }
  return token;
}

async function status(path: string, token: string): Promise<number> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status;
}

/**
 * 401 e 403 são recusa. 404 é ambíguo — pode ser guard recusando ou rota que
 * não existe — e por isso conta como FALHA aqui: sonda que não prova nada não
 * pode passar por prova.
 */
function recusou(code: number): boolean {
  return code === 401 || code === 403;
}

async function main() {
  const cpf = exigir('LEAK_CPF');
  const cpfPass = exigir('LEAK_CPF_PASS');
  const email = exigir('LEAK_EMAIL');
  const emailPass = exigir('LEAK_EMAIL_PASS');

  const associado = await login('/app/auth/login', { cpf, password: cpfPass });
  const interno = await login('/auth/login', { email, password: emailPass });

  const falhas: string[] = [];

  async function conferir(
    rotulo: string,
    token: string,
    path: string,
  ): Promise<void> {
    const code = await status(path, token);
    const ok = recusou(code);
    console.log(`${rotulo} -> ${path}: ${code} ${ok ? 'OK' : 'VAZOU'}`);
    if (!ok) falhas.push(`${rotulo} recebeu ${code} em ${path}`);
  }

  // Token de associado não pode tocar em NADA fora do mundo dele.
  for (const sonda of LEAK_PROBES) {
    if (sonda.world === 'associate') continue;
    await conferir('associado', associado, sonda.path);
  }

  // Token interno não pode tocar no mundo do cliente nem no do técnico.
  for (const sonda of LEAK_PROBES) {
    if (sonda.world === 'internal') continue;
    await conferir('interno', interno, sonda.path);
  }

  // Assinatura adulterada tem que morrer na verificação.
  await conferir('token adulterado', `${interno}x`, '/devices');

  if (falhas.length) {
    console.error('\nVAZAMENTO DETECTADO:\n' + falhas.join('\n'));
    process.exit(1);
  }
  console.log(`\n${LEAK_PROBES.length} sondas conferidas. Fronteira intacta.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
