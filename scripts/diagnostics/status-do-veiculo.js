/**
 * Teste de regressão: carro desligado NUNCA vira "GPS com defeito".
 *
 * Regra do dono (30/09/2026): "GPS desligado só é quando não está vinculado a
 * nenhum veículo, você perdeu o GPS ou defeito — nunca porque o veículo só
 * está desligado". O GT06/J16 cala quando a chave desliga (97% dos
 * rastreadores vivos ficam mudos por mais de 1 h em qualquer janela de 2 dias,
 * medido no Traccar em 30/09/2026) e volta sozinho quando ela gira.
 *
 * Roda a função de verdade (`getDisplayStatus`, transpilada com esbuild) nos
 * cenários que doeram em produção.
 *
 * Rodar:  node scripts/diagnostics/status-do-veiculo.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const RAIZ = path.resolve(__dirname, '..', '..');
const DASH = path.join(RAIZ, 'frontend', 'dashboard');
const FONTE = path.join(DASH, 'src/lib/utils.ts');

// API JS, não o binário: no Windows o .cmd exige shell e o Node 20+ recusa.
const esbuild = require(path.join(RAIZ, 'node_modules', 'esbuild'));

let falhou = false;
function checar(nome, condicao, detalhe) {
  if (condicao) {
    console.log('  ok   ' + nome);
  } else {
    falhou = true;
    console.error('  X    ' + nome + (detalhe ? ' -> ' + detalhe : ''));
  }
}

const saida = path.join(os.tmpdir(), 'status-veiculo-' + process.pid + '.cjs');
esbuild.buildSync({
  entryPoints: [FONTE],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias: { '@': path.join(DASH, 'src') },
  outfile: saida,
});
const { getDisplayStatus } = require(saida);

const AGORA = Date.parse('2026-09-30T15:00:00Z');
const antes = (ms) => new Date(AGORA - ms).toISOString();
const H = 3600_000;
const realNow = Date.now;
Date.now = () => AGORA;

console.log('\n########## status do veículo');

// Carro desligado há 5 h: o rastreador calou junto com a chave. É LARANJA.
checar(
  'parado há 5 h com rastreador calado = Desligado (laranja)',
  getDisplayStatus('unknown', 0, antes(5 * H), 'ACTIVE', antes(5 * H)) === 'ignition_off',
  getDisplayStatus('unknown', 0, antes(5 * H), 'ACTIVE', antes(5 * H)),
);

// Fim de semana inteiro na garagem: 60 h calado ainda é carro parado.
checar(
  'calado há 60 h (fim de semana) = Desligado, não defeito',
  getDisplayStatus('unknown', 0, antes(60 * H), 'ACTIVE', antes(60 * H)) === 'ignition_off',
);

// Passou de 3 dias: perdeu, arrancaram ou quebrou. Aí sim é VERMELHO.
checar(
  'calado há 4 dias = GPS com defeito (vermelho)',
  getDisplayStatus('unknown', 0, antes(4 * 24 * H), 'ACTIVE', antes(4 * 24 * H)) === 'offline',
);

// O Traccar diz "offline" toda vez que a conexão TCP fecha — o GT06 fecha e
// reabre o tempo todo. Contato de 1 min atrás é rastreador vivo.
checar(
  'Traccar "offline" com contato há 1 min NÃO é defeito',
  getDisplayStatus('offline', 0, antes(60_000), 'ACTIVE', antes(60_000)) === 'ignition_off',
);

// Volta automática: assim que o rastreador fala de novo, o status muda sozinho.
checar(
  'rastreador voltou a falar agora, andando = Ligado (verde)',
  getDisplayStatus('online', 20, antes(5_000), 'ACTIVE', antes(5_000)) === 'ignition_on',
);

// Velocidade congelada numa posição velha continua sendo "parado".
checar(
  'posição de 30 min com 6 km/h congelado = Desligado',
  getDisplayStatus('online', 3.2, antes(30_000), 'ACTIVE', antes(30 * 60_000)) === 'ignition_off',
);

checar(
  'bloqueado manda em tudo',
  getDisplayStatus('online', 20, antes(5_000), 'BLOCKED', antes(5_000)) === 'alert',
);

checar(
  'sem data de contato nenhuma = defeito (não finge que está vivo)',
  getDisplayStatus('unknown', 0, 'sem-data', 'ACTIVE', null) === 'offline',
);

Date.now = realNow;
try {
  fs.unlinkSync(saida);
} catch {
  /* nada */
}

if (falhou) {
  console.error('\nFALHOU');
  process.exit(1);
}
console.log('\nOK');
