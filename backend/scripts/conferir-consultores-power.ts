/**
 * Conferência SOMENTE LEITURA do caminho Power → linha de `consultants`, sem banco.
 * Uso: POWER_LOGIN_USERNAME=... POWER_LOGIN_PASSWORD=... POWER_COMPANY_ID=... npx tsx scripts/conferir-consultores-power.ts
 */
import { ConfigService } from '@nestjs/config';
import { PowerPanelClient } from '../src/modules/consultants/power-panel.client';
import { coletaCompleta, paraLinha, type UsuarioPower } from '../src/modules/consultants/consultants.mapper';

async function main() {
  const config = new ConfigService({
    power: {
      baseUrl: process.env.POWER_APP_BASE_URL || 'https://app.powercrm.com.br',
      companyId: process.env.POWER_COMPANY_ID,
      username: process.env.POWER_LOGIN_USERNAME,
      password: process.env.POWER_LOGIN_PASSWORD,
    },
  });
  const client = new PowerPanelClient(config);
  const todos: UsuarioPower[] = [];
  let anunciados = 0;
  for (let p = 0; p < 30; p++) {
    const r = await client.listarUsuarios(p, 1000);
    anunciados = r.totalElements;
    if (!r.content.length) break;
    todos.push(...r.content);
    if (p + 1 >= r.totalPages && todos.length >= anunciados) break;
  }
  const linhas = todos.map((u) => paraLinha(u, 'conferencia'));
  const conta = (f: (l: (typeof linhas)[number]) => boolean) => linhas.filter(f).length;
  console.log({
    anunciados,
    coletados: linhas.length,
    completa: coletaCompleta(linhas.length, anunciados),
    ativos: conta((l) => l.active),
    bloqueados: conta((l) => !l.active),
    comEmail: conta((l) => !!l.email),
    comCelular: conta((l) => !!l.mobile),
    celularFormatoEstranho: conta((l) => !!l.mobile && ![10, 11, 12, 13].includes(l.mobile.length)),
    docOk: conta((l) => !!l.document && [11, 14].includes(l.document.length)),
    semDoc: conta((l) => !l.document),
    // Texto que existia no Power mas não virou data = parser errado.
    cadastroNaoLido: todos.filter((u, i) => (u.createdAt ?? '').trim() && !linhas[i].powerCreatedAt).length,
    acessoNaoLido: todos.filter((u, i) => (u.lastAccess ?? '').trim() && !linhas[i].lastAccessAt).length,
    bloqueioNaoLido: todos.filter((u, i) => (u.blockedAt ?? '').trim() && !linhas[i].blockedAt).length,
    exemploDatas: todos.slice(0, 2).map((u, i) => [u.createdAt, linhas[i].powerCreatedAt?.toISOString()]),
  });
}

main().catch((e) => {
  console.error('ERRO', e instanceof Error ? e.message : e);
  process.exit(1);
});
