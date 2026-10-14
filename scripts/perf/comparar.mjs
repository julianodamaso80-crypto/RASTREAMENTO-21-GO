#!/usr/bin/env node
/**
 * Junta até três resultados do `medir-experiencia.mjs` (nosso antes, nosso
 * depois, Rede Veículos) na tabela que o dono pediu:
 *
 *   Funcionalidade | Nosso antes | Nosso depois | Rede Veículos |
 *   Atualização dos dados | Erros | Situação | Evidência
 *
 * Uso:
 *   node scripts/perf/comparar.mjs \
 *     --antes  scripts/perf/resultados/<carimbo>-nosso.json \
 *     --depois scripts/perf/resultados/<carimbo>-nosso.json \
 *     --rdv    scripts/perf/resultados/<carimbo>-rdv.json \
 *     [--saida scripts/perf/resultados/comparacao.md]
 *   Qualquer um dos três pode faltar; a coluna sai "não medido".
 *
 * Situação (regras do plano 2026-10-14, nesta ordem):
 *   1. sem amostra válida nem antes nem depois  → "Não testado — acesso pendente"
 *   2. sem "depois", ou "depois" fora de produção (nível < 4)
 *                                               → "Aguardando publicação ou aprovação"
 *   3. "depois" em produção e dentro da meta    → "Validado e dentro da meta"
 *   4. "depois" em produção, fora da meta, comparado com "antes" (B, mediana):
 *        mais rápido além da variação           → "Melhorou, abaixo da meta"
 *        dentro da variação / sem "antes" / modos diferentes
 *                                               → "Inconclusiva"
 *        mais lento além da variação            → "Piorou — investigar" (fora da lista
 *                                                 do plano, mas esconder regressão não é opção)
 *   Metas (constraints globais): navegação de página → B p75 ≤ 2,5 s (o LCP de
 *   referência); interação na página → A p95 ≤ 100 ms e INP p75 ≤ 200 ms.
 *   "Variação" = max(espalhamento p95−mediana, 10 % da maior mediana).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  carimbo,
  compararMedianas,
  idadeLegivel,
  lerArgs,
  ms,
  NIVEIS,
  ROTULO_DA_ACAO,
  TIPO_DA_ACAO,
} from './comum.mjs';

const META = {
  navegacao: (s) => s.B.p75 !== null && s.B.p75 <= 2500,
  interacao: (s) => s.A.p95 !== null && s.A.p95 <= 100 && (s.inp.p75 === null || s.inp.p75 <= 200),
};

function carregar(arq, rotulo) {
  if (!arq) return null;
  const j = JSON.parse(fs.readFileSync(arq, 'utf8'));
  if (!j.meta || !j.resumo) throw new Error(`${arq} não parece saída do medir-experiencia.mjs`);
  return { ...j, arquivo: path.basename(arq), rotulo };
}

const valido = (s) => s && s.n_ok > 0;

function celula(r, acao) {
  if (!r) return 'não medido';
  const s = r.resumo[acao];
  if (!s) return 'não medido';
  if (!valido(s)) return s.motivos.length ? s.motivos.join('; ') : 'falhou';
  const p99 = s.B.p99 !== null ? `, p99 ${ms(s.B.p99)}` : '';
  const pequena = s.n_ok < 5 ? ' · amostra pequena' : '';
  return `${ms(s.B.mediana)} (p95 ${ms(s.B.p95)}${p99}; A ${ms(s.A.mediana)}; n=${s.n_ok}${pequena})`;
}

function situacao(antes, depois, acao) {
  const sa = antes && antes.resumo[acao];
  const sd = depois && depois.resumo[acao];
  if (!valido(sa) && !valido(sd)) return 'Não testado — acesso pendente';
  if (!valido(sd) || depois.meta.nivel < 4) return 'Aguardando publicação ou aprovação';
  const tipo = TIPO_DA_ACAO[acao];
  if (META[tipo](sd)) return 'Validado e dentro da meta';
  if (!valido(sa)) return 'Inconclusiva (sem medição "antes")';
  if (antes.meta.modo !== depois.meta.modo) return 'Inconclusiva (antes e depois em modos diferentes)';
  const c = compararMedianas(sd.B, sa.B);
  if (c.veredito === 'mais rápido') return 'Melhorou, abaixo da meta';
  if (c.veredito === 'mais lento') return 'Piorou — investigar';
  return 'Inconclusiva';
}

function atualizacao(nosso, rdv, acao) {
  const parte = (r, nome) => {
    const s = r && r.resumo[acao];
    if (!valido(s) || s.C.n === 0) return `${nome} —`;
    return `${nome} ${idadeLegivel(s.C.mediana)}`;
  };
  return `${parte(nosso, 'nosso')} · ${parte(rdv, 'RDV')}`;
}

function erros(nosso, rdv, acao) {
  const parte = (r, nome) => {
    const s = r && r.resumo[acao];
    if (!valido(s)) return `${nome} —`;
    return `${nome} ${s.erros} erro(s), long task máx ${ms(s.long_max)}`;
  };
  return `${parte(nosso, 'nosso')} · ${parte(rdv, 'RDV')}`;
}

function evidencia(lista, acao) {
  return lista
    .filter(Boolean)
    .map((r) => {
      const s = r.resumo[acao];
      const vol = s && s.volume ? ` vol ${JSON.stringify(s.volume)}` : '';
      return `${r.rotulo}: nível ${r.meta.nivel}, ${r.meta.modo}, ${r.arquivo}${vol}`;
    })
    .join(' · ');
}

function main() {
  const o = lerArgs(process.argv.slice(2), { antes: '', depois: '', rdv: '', saida: '' });
  const antes = carregar(o.antes, 'antes');
  const depois = carregar(o.depois, 'depois');
  const rdv = carregar(o.rdv, 'RDV');
  if (!antes && !depois && !rdv) throw new Error('Passe ao menos um de --antes, --depois, --rdv.');

  const acoes = Object.keys(ROTULO_DA_ACAO).filter((a) =>
    [antes, depois, rdv].some((r) => r && r.meta.acoes.includes(a)),
  );
  const nossoAtual = (acao) => (depois && valido(depois.resumo[acao]) ? depois : antes);

  const L = [];
  L.push(`# Velocidade real — nosso painel × Rede Veículos (${new Date().toLocaleString('pt-BR')})`, '');
  for (const r of [antes, depois, rdv].filter(Boolean)) {
    L.push(`- **${r.rotulo}**: ${r.meta.base} · nível ${r.meta.nivel} (${NIVEIS[r.meta.nivel]}) · modo ${r.meta.modo} · ${r.meta.rodadas} rodadas · versão ${r.meta.versao} · flags ${r.meta.flags || '—'} · ${r.arquivo}`);
  }
  const modos = new Set([antes, depois, rdv].filter(Boolean).map((r) => r.meta.modo));
  if (modos.size > 1) L.push('', '> ⚠️ Os resultados misturam modo frio e quente — compare só colunas do mesmo modo.');
  L.push('', 'Células de tempo: B (resultado utilizável) mediana, com p95, A (primeira resposta visual) e n.', '');
  L.push('| Funcionalidade | Nosso antes | Nosso depois | Rede Veículos | Atualização dos dados | Erros | Situação | Evidência |');
  L.push('|---|---|---|---|---|---|---|---|');
  const situacoes = {};
  for (const acao of acoes) {
    situacoes[acao] = situacao(antes, depois, acao);
    L.push(
      `| ${ROTULO_DA_ACAO[acao]} | ${celula(antes, acao)} | ${celula(depois, acao)} | ${celula(rdv, acao)} | ${atualizacao(nossoAtual(acao), rdv, acao)} | ${erros(nossoAtual(acao), rdv, acao)} | ${situacoes[acao]} | ${evidencia([antes, depois, rdv], acao)} |`,
    );
  }

  L.push('', '## Já rápido na versão publicada', '');
  const rapidos = acoes.filter((a) => situacoes[a] === 'Validado e dentro da meta');
  L.push(rapidos.length ? rapidos.map((a) => `- ${ROTULO_DA_ACAO[a]}`).join('\n') : '- (nenhuma ação validada em produção ainda)');

  L.push('', '## Ainda lento e o que será feito', '');
  const lentos = acoes.filter((a) => /abaixo da meta|Inconclusiva|Piorou/.test(situacoes[a]));
  L.push(lentos.length ? lentos.map((a) => `- ${ROTULO_DA_ACAO[a]} — ${situacoes[a]}. O que será feito: _(preencher)_`).join('\n') : '- (nada medido em produção fora da meta)');

  L.push('', '## Mais rápido / equivalente / mais lento que a Rede Veículos', '');
  if (!rdv) L.push('- RDV não medida nesta comparação.');
  for (const acao of acoes) {
    if (!rdv) break;
    const nosso = nossoAtual(acao);
    const sn = nosso && nosso.resumo[acao];
    const sr = rdv.resumo[acao];
    if (!valido(sr)) {
      L.push(`- ${ROTULO_DA_ACAO[acao]}: RDV ${sr && sr.motivos.length ? sr.motivos.join('; ') : 'não medida'}`);
      continue;
    }
    if (!valido(sn)) {
      L.push(`- ${ROTULO_DA_ACAO[acao]}: nosso não medido`);
      continue;
    }
    const avisos = [];
    if (nosso.meta.modo !== rdv.meta.modo) avisos.push('modos diferentes — comparação inválida');
    if (nosso.meta.nivel !== 4) avisos.push(`nosso no nível ${nosso.meta.nivel}, RDV é produção`);
    const c = compararMedianas(sn.B, sr.B);
    const texto = { 'mais rápido': 'mais rápido', 'mais lento': 'mais lento', inconclusiva: 'equivalente (diferença dentro da variação)' }[c.veredito] || c.veredito;
    L.push(
      `- ${ROTULO_DA_ACAO[acao]}: nosso ${texto} — ${ms(sn.B.mediana)} × ${ms(sr.B.mediana)}${c.diff !== null ? ` (dif. ${ms(Math.abs(c.diff))}, variação ${ms(c.limiar)})` : ''}${avisos.length ? ` ⚠️ ${avisos.join('; ')}` : ''}`,
    );
  }

  L.push('', '## Único próximo gasto ou aprovação', '', '- _(preencher pelo responsável)_', '');
  const texto = L.join('\n');
  const saida = o.saida || path.join('scripts', 'perf', 'resultados', `${carimbo()}-comparacao.md`);
  fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
  fs.writeFileSync(saida, texto, 'utf8');
  console.log(texto);
  console.log(`\ncomparação gravada em ${saida}`);
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
