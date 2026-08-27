/**
 * Teste de regressão: o histórico da TAG não mente sobre o que a TAG sabe.
 *
 * A TAG não tem ignição, não tem hodômetro e não reporta sozinha — ela é vista
 * quando um aparelho com Find My passa perto dela, com atraso que medimos
 * entre 8 e 47 minutos. Três afirmações, portanto, são PROIBIDAS na tela:
 *
 *  1. "motor desligado" / "desligou" — TAG não faz ideia do estado do motor.
 *     Só o rastreador sabe disso. Escrever isso num painel de TAG faz o
 *     operador acreditar num dado que ninguém coletou.
 *
 *  2. "km percorridos" / "quilometragem" — somar as retas entre avistamentos
 *     não é a distância que o veículo rodou. Entre dois pontos separados por
 *     horas o carro pode ter ido a qualquer lugar. A plataforma concorrente
 *     publica esse número; nós não.
 *
 *  3. "em tempo real" / "agora mesmo" — a posição da TAG é sempre passado.
 *
 * O teste roda as funções de verdade (transpiladas com esbuild) e também varre
 * o texto dos componentes atrás das palavras proibidas.
 *
 * Rodar:  node scripts/diagnostics/tag-historico-honesto.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const RAIZ = path.resolve(__dirname, '..', '..');
const DASH = path.join(RAIZ, 'frontend', 'dashboard');
const FONTE_FRASES = path.join(
  DASH,
  'src/components/ble-tags/tag-historico-frases.ts',
);

/** Componentes da TAG que chegam aos olhos do operador. */
const COMPONENTES = [
  'src/components/ble-tags/tag-historico-frases.ts',
  'src/components/ble-tags/tag-insights-panel.tsx',
  'src/components/ble-tags/tag-trail-map.tsx',
];

/** Cada regra: rótulo + regex do que não pode aparecer no texto visível. */
const PROIBIDO = [
  ['estado do motor', /deslig|ignic|ignição|motor\s+(ligado|parado)/i],
  ['quilometragem', /\bkm\b|quilometr|mileage|hodometro|hodômetro/i],
  ['promessa de tempo real', /tempo\s+real|agora\s+mesmo|ao\s+vivo/i],
];

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

// ---------------------------------------------------------------- comportamento
console.log('\n########## frases geradas');

const saida = path.join(os.tmpdir(), 'tag-frases-' + process.pid + '.cjs');
esbuild.buildSync({
  entryPoints: [FONTE_FRASES],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // O import de tipos some na transpilação; o alias não precisa resolver.
  external: ['@/*'],
  outfile: saida,
});
const frases = require(saida);

const pernoite = frases.frasePernoite({
  endereco: 'Rua da Casa, Campo Grande',
  diasDistintos: 6,
  faixaHorariaTexto: '22h–05h',
  participacaoPct: 90,
  centroLat: 0,
  centroLng: 0,
  totalAvistamentos: 40,
});
console.log('  pernoite: ' + pernoite);
checar('pernoite descreve costume', /costuma passar a noite/i.test(pernoite));
checar('pernoite cita o endereço', pernoite.includes('Rua da Casa'));
checar('pernoite conta as noites', pernoite.includes('6 noites'));

const paradoAgora = frases.fraseUltimaParada(
  {
    endereco: 'Av. Exemplo, 100',
    paradoDesde: '2026-08-26T00:04:00Z',
    aindaLa: true,
    ultimoAvistamento: '2026-08-26T00:20:00Z',
    centroLat: 0,
    centroLng: 0,
  },
  new Date('2026-08-26T00:25:00Z'),
);
console.log('  parado (ainda lá): ' + paradoAgora);
checar('parada usa "Parado em ... desde"', /^Parado em .+ desde /.test(paradoAgora));

const paradoAntigo = frases.fraseUltimaParada(
  {
    endereco: 'Av. Exemplo, 100',
    paradoDesde: '2026-08-25T20:00:00Z',
    aindaLa: false,
    ultimoAvistamento: '2026-08-25T21:00:00Z',
    centroLat: 0,
    centroLng: 0,
  },
  new Date('2026-08-26T00:00:00Z'),
);
console.log('  parado (envelheceu): ' + paradoAntigo);
checar(
  'avistamento velho vira "última vez visto"',
  /última vez visto/i.test(paradoAntigo),
);
checar(
  'avistamento velho explica a limitação da TAG',
  /passa perto/i.test(paradoAntigo),
);
checar('avistamento velho informa a idade', /há 3h/.test(paradoAntigo));

const semEndereco = frases.fraseUltimaParada(
  {
    endereco: null,
    paradoDesde: '2026-08-26T00:04:00Z',
    aindaLa: true,
    ultimoAvistamento: '2026-08-26T00:20:00Z',
    centroLat: 0,
    centroLng: 0,
  },
  new Date('2026-08-26T00:25:00Z'),
);
checar(
  'sem endereço não imprime "null" na tela',
  !semEndereco.includes('null'),
  semEndereco,
);

for (const [rotulo, regex] of PROIBIDO) {
  const todas = [pernoite, paradoAgora, paradoAntigo, semEndereco];
  const suja = todas.find((f) => regex.test(f));
  checar('nenhuma frase afirma ' + rotulo, !suja, suja);
}

fs.unlinkSync(saida);

// ------------------------------------------------------------------- vocabulário
console.log('\n########## vocabulário dos componentes');

for (const relativo of COMPONENTES) {
  const src = fs.readFileSync(path.join(DASH, relativo), 'utf8');
  // Só o texto que o operador lê: comentários explicam justamente o que é
  // proibido, e não podem derrubar o teste.
  const semComentarios = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  for (const [rotulo, regex] of PROIBIDO) {
    const achado = semComentarios.match(regex);
    checar(
      relativo + ' não afirma ' + rotulo,
      !achado,
      achado ? '"' + achado[0] + '"' : '',
    );
  }
}

if (falhou) {
  console.error(
    '\nFALHOU: o histórico da TAG está afirmando algo que a TAG não sabe.',
  );
  process.exit(1);
}
console.log('\nOK: o histórico da TAG só afirma o que os avistamentos sustentam.');
