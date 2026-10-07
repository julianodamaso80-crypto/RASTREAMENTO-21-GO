/**
 * Teste de regressão: o status do veículo segue a régua da RedeVeiculos.
 *
 * Pedido do dono (07/10/2026): "faça identico da rede". Associado lia
 * "GPS com defeito · favor entrar em contato com a central" num carro só
 * parado e ligava para a empresa. A Rede nunca diz defeito: mostra o estado da
 * comunicação (ONLINE, S/RESP, S/GPS, SLEEP, OFFLINE) e "Última atualização há X".
 *
 * Régua lida no código e nos dados da Rede em 07/10/2026
 * (`colorIconAtivoGPSAndSinal` do mapa /rastreamento/v2/):
 *  - comunicou há até 30 min, com GPS              → ONLINE   verde
 *  - comunicou há 30–60 min                        → S/RESP   amarelo
 *  - comunicando (até 60 min) mas sem posição GPS  → S/GPS    preto
 *  - moto calada há menos de 2 dias                → SLEEP    azul
 *  - o resto                                       → OFFLINE  laranja
 * Carro parado continua ONLINE enquanto o rastreador manda sinal de vida,
 * mesmo com o GPS parado há dias (na Rede: GPS de 67 h, contato agora = ONLINE).
 *
 * Roda a função de verdade (`getDisplayStatus`, transpilada com esbuild).
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
function checar(nome, obtido, esperado) {
  if (obtido === esperado) {
    console.log('  ok   ' + nome);
  } else {
    falhou = true;
    console.error('  X    ' + nome + ' -> veio ' + obtido + ', esperado ' + esperado);
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
const { getDisplayStatus, getVehicleStatusLabel } = require(saida);

const AGORA = Date.parse('2026-10-07T15:00:00Z');
const antes = (ms) => new Date(AGORA - ms).toISOString();
const MIN = 60_000;
const H = 60 * MIN;
const realNow = Date.now;
Date.now = () => AGORA;

/** Veículo com posição GPS válida, contato e GPS nas idades pedidas. */
function st({ contato, gps = contato, tipo = 'CAR', status = 'ACTIVE', semPosicao = false }) {
  return getDisplayStatus({
    lastUpdate: contato == null ? '' : antes(contato),
    positionTime: semPosicao ? null : antes(gps),
    latitude: semPosicao ? 0 : -22.95,
    longitude: semPosicao ? 0 : -43.68,
    vehicleStatus: status,
    vehicleType: tipo,
  });
}

console.log('\n########## status do veículo (régua da Rede)');

checar('contato agora, GPS agora = ONLINE', st({ contato: MIN }), 'online');
checar(
  'carro parado: contato agora, GPS de 67 h = ONLINE (igual à Rede)',
  st({ contato: 2 * MIN, gps: 67 * H }),
  'online',
);
checar('contato há 29 min = ONLINE', st({ contato: 29 * MIN }), 'online');
checar('contato há 48 min = S/RESP', st({ contato: 48 * MIN }), 'sem_resp');
checar('contato há 61 min = OFFLINE', st({ contato: 61 * MIN }), 'offline');
checar('carro calado há 6 dias = OFFLINE, não defeito', st({ contato: 6 * 24 * H }), 'offline');
checar('falando agora sem nenhuma posição GPS = S/GPS', st({ contato: MIN, semPosicao: true }), 'sem_gps');
checar('moto calada há 10 h = SLEEP', st({ contato: 10 * H, tipo: 'MOTORCYCLE' }), 'sleep');
checar('moto calada há 3 dias = OFFLINE', st({ contato: 3 * 24 * H, tipo: 'MOTORCYCLE' }), 'offline');
checar('carro calado há 10 h = OFFLINE (sleep é só moto)', st({ contato: 10 * H }), 'offline');
checar('sem data de contato = OFFLINE', st({ contato: null }), 'offline');
checar('bloqueado continua Bloqueado', st({ contato: MIN, status: 'BLOCKED' }), 'alert');

console.log('\n########## rótulos (os mesmos da Rede)');
checar('online', getVehicleStatusLabel('online'), 'ONLINE');
checar('sem_resp', getVehicleStatusLabel('sem_resp'), 'S/RESP');
checar('sem_gps', getVehicleStatusLabel('sem_gps'), 'S/GPS');
checar('sleep', getVehicleStatusLabel('sleep'), 'SLEEP');
checar('offline', getVehicleStatusLabel('offline'), 'OFFLINE');

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
