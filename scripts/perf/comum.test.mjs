/**
 * Testes das funções puras de comum.mjs (sem navegador).
 *   node --test scripts/perf/comum.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compararMedianas, estatistica, idadeDoTexto, mediana, percentil } from './comum.mjs';

test('mediana: n ímpar pega o central, n par faz a média dos dois centrais', () => {
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([4, 1, 3, 2]), 2.5);
  assert.equal(mediana([]), null);
});

test('estatistica: p50 clássico; p75/p95 nearest-rank; p99 só com n ≥ 20', () => {
  const e = estatistica([10, 20, 30, 40]);
  assert.equal(e.mediana, 25);
  assert.equal(e.p75, 30);
  assert.equal(e.p95, 40);
  assert.equal(e.p99, null);
  const vinte = estatistica(Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(vinte.mediana, 10.5);
  assert.equal(vinte.p95, 19);
  assert.equal(vinte.p99, 20);
  assert.equal(percentil([1, 2, 3, 4, 5], 95), 5);
});

test('compararMedianas: inconclusiva dentro da variação', () => {
  const a = estatistica([100, 105, 110, 115, 120]);
  const b = estatistica([104, 108, 112, 116, 124]);
  assert.equal(compararMedianas(a, b).veredito, 'inconclusiva');
  const rapido = estatistica([100, 110, 120, 130, 200]);
  const lento = estatistica([300, 310, 320, 330, 340]);
  assert.equal(compararMedianas(rapido, lento).veredito, 'mais rápido');
});

test('idadeDoTexto: data absoluta em BRT e frase relativa em faixa', () => {
  const agora = Date.UTC(2026, 9, 14, 13, 0, 0); // 10:00 em Brasília
  assert.equal(idadeDoTexto('14/10/2026, 09:58:30', agora).idade_s, 90);
  assert.deepEqual(idadeDoTexto('Última atualização há 3 minutos', agora).faixa, [150, 210]);
  assert.equal(idadeDoTexto('sem data', agora), null);
});
