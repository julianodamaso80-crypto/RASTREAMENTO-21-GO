/**
 * Preenche `devices.install_location` e `tag_links.install_location` a partir
 * do relatório de Ativos da plataforma de origem (RedeVeiculos).
 *
 * Uso:
 *   npx ts-node scripts/import-rdv-local-instalacao.ts <ativos_rdv.json> --tenant <uuid> --sql <saida.sql>
 *
 * O arquivo é a resposta crua de `GET /veiculos/VeiculosController?exportacao=todos`
 * (planilha como `[[{text}], ...]`). Gera SQL para rodar com psql dentro do
 * container do Postgres — o banco de produção não é exposto para fora.
 *
 * Só preenche o que está vazio; o que o técnico informou por aqui prevalece.
 * Casamento estrito pelo número do equipamento (IMEI / série), nunca por placa.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  lerLocaisRdv,
  montarSqlLocais,
} from '../src/modules/clients/rdv/local-instalacao-rdv';

function main() {
  const [arquivo] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const iTenant = process.argv.indexOf('--tenant');
  const iSql = process.argv.indexOf('--sql');
  const tenantId = iTenant >= 0 ? process.argv[iTenant + 1] : null;
  const sqlOut = iSql >= 0 ? process.argv[iSql + 1] : null;
  if (!arquivo || !tenantId || !sqlOut) {
    console.error(
      'uso: import-rdv-local-instalacao.ts <ativos_rdv.json> --tenant <uuid> --sql <saida.sql>',
    );
    process.exit(1);
  }

  const planilha = JSON.parse(readFileSync(arquivo, 'utf-8'));
  const locais = lerLocaisRdv(planilha);
  const rastreadores = locais.filter((l) => !l.tag && l.imei).length;
  const tags = locais.filter((l) => l.tag && l.identificador).length;
  console.log(
    `linhas ${planilha.length - 1} · com local ${locais.length} · rastreadores ${rastreadores} · TAGs ${tags}`,
  );
  writeFileSync(sqlOut, montarSqlLocais(locais, tenantId), 'utf-8');
  console.log(`SQL em ${sqlOut}`);
}

main();
