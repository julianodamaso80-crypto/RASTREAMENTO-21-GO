/**
 * Teste de regressão: a gramática visual do calendário da agenda.
 *
 * A plataforma de origem (RedeVeiculos, medida em 10/09/2026) usa DOIS canais
 * independentes no bloco do calendário:
 *
 *   COR   = tipo de serviço  (instalação, manutenção, retirada, demais)
 *   ÍCONE = desfecho         (agendado, concluído, cancelado, frustrada...)
 *
 * São informações diferentes. Se um dia alguém "simplificar" pintando o bloco
 * pelo status, a grade perde a leitura de qual serviço é cada um — que é
 * justamente o que o operador procura ao bater o olho no mês.
 *
 * Fora isso, três avisos precisam sobreviver no bloco porque cada um custou uma
 * decisão operacional: 📍 concluído sem localização válida (o técnico negou o
 * GPS), ⏰/🚀/🔀 execução fora do horário combinado, e 💬 resposta do técnico.
 *
 * Rodar:  node scripts/diagnostics/agenda-gramatica-visual.js
 */
const path = require('path');
const os = require('os');

const RAIZ = path.resolve(__dirname, '..', '..');
const DASH = path.join(RAIZ, 'frontend', 'dashboard');
const FONTE = path.join(DASH, 'src/app/(dashboard)/agenda/agenda-visual.ts');

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

const saida = path.join(os.tmpdir(), 'agenda-visual-' + process.pid + '.cjs');
esbuild.buildSync({
  entryPoints: [FONTE],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['@/*'],
  outfile: saida,
});
const v = require(saida);

const BASE = {
  id: 'a1',
  osNumber: '20260910/1',
  serviceType: 'INSTALLATION',
  status: 'SCHEDULED',
  technicianStatus: null,
  executionTiming: 'ON_TIME',
  start: '2026-09-15T08:00:00',
  end: '2026-09-15T12:00:00',
  plate: 'RFQ8B04',
  clientName: 'JEFERSON',
  address: null,
  autoScheduled: false,
  hasTechnicianReply: false,
  locationDenied: false,
  technicianId: 't1',
  technicianName: 'CAUÃ',
  statusDiverge: false,
};

console.log('\n########## cor = tipo de serviço');

const cores = Object.values(v.COR_SERVICO);
checar('os quatro tipos têm cores distintas', new Set(cores).size === 4);
checar('instalação é verde', /^#1|^#0/.test(v.COR_SERVICO.INSTALLATION));
checar(
  'retirada não usa a cor da manutenção',
  v.COR_SERVICO.REMOVAL !== v.COR_SERVICO.MAINTENANCE,
);

console.log('\n########## ícone = desfecho');

checar(
  'concluído e executado compartilham o ícone',
  v.iconeStatus('COMPLETED') === v.iconeStatus('EXECUTED'),
);
checar(
  'as três formas de cancelar compartilham o ícone',
  v.iconeStatus('CANCELED') === v.iconeStatus('CANCELED_BY_CLIENT') &&
    v.iconeStatus('CANCELED') === v.iconeStatus('CLOSED_BY_SYSTEM'),
);
checar(
  'agendado e concluído não usam o mesmo ícone',
  v.iconeStatus('SCHEDULED') !== v.iconeStatus('COMPLETED'),
);
checar(
  'visita frustrada não se confunde com cancelado',
  v.iconeStatus('FRUSTRATED_CLIENT') !== v.iconeStatus('CANCELED'),
);

console.log('\n########## execução fora do horário');

checar('no horário não ganha ícone', v.iconeTiming('ON_TIME') === '');
const timings = new Set([
  v.iconeTiming('TECHNICIAN_LATE'),
  v.iconeTiming('TECHNICIAN_EARLY'),
  v.iconeTiming('ANTICIPATED_BY_TECHNICIAN'),
]);
checar('atraso, adianto e antecipação são distintos', timings.size === 3);

console.log('\n########## bloco montado');

const simples = v.prefixoDoEvento(BASE);
console.log('  simples: ' + simples);
checar('bloco agendado mostra só o relógio', simples === '🕐');

const cheio = v.prefixoDoEvento({
  ...BASE,
  status: 'COMPLETED',
  executionTiming: 'TECHNICIAN_LATE',
  hasTechnicianReply: true,
  autoScheduled: true,
  locationDenied: true,
});
console.log('  cheio: ' + cheio);
checar('avisos vêm antes do desfecho', cheio.endsWith(v.iconeStatus('COMPLETED')));
checar('atraso aparece', cheio.includes('⏰'));
checar('resposta do técnico aparece', cheio.includes('💬'));
checar('auto-agendamento aparece', cheio.includes('💡'));

const semGps = v.prefixoDoEvento({
  ...BASE,
  status: 'COMPLETED',
  locationDenied: true,
});
checar(
  'concluído sem localização válida é visível no bloco',
  semGps.includes('📍'),
  semGps,
);

console.log('\n########## cancelado desbota');

checar('cancelado fica mais fraco', v.opacidadeDoEvento('CANCELED') < 1);
checar('agendado fica cheio', v.opacidadeDoEvento('SCHEDULED') === 1);
checar('concluído fica cheio', v.opacidadeDoEvento('COMPLETED') === 1);

console.log('\n########## legenda cobre o que a grade desenha');

checar('legenda de cor tem os quatro tipos', v.LEGENDA_SERVICO.length === 4);
const iconesLegenda = v.LEGENDA_ICONE.map((l) => l.icone);
for (const obrigatorio of ['🕐', '✔️', '❌', '⏰', '💬', '💡', '📍']) {
  checar(
    'legenda explica ' + obrigatorio,
    iconesLegenda.includes(obrigatorio),
  );
}

if (falhou) {
  console.error(
    '\nFALHOU: o calendário da agenda perdeu a leitura de cor x ícone.',
  );
  process.exit(1);
}
console.log('\nOK: cor diz o serviço, ícone diz o desfecho, avisos preservados.');
