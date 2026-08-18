#!/usr/bin/env node
/**
 * Vínculo em lote de rastreadores instalados — pela MESMA API do botão
 * "Associar ao SGA" (POST /stock/:id/associate), item por item, com as mesmas
 * validações e efeitos (SGA, Traccar, pendência, rota, primeira posição).
 *
 * Roda de dentro do container do backend (tem rede pro Postgres e pro próprio
 * Nest em localhost:3001):
 *
 *   docker cp scripts/vincular-lote.js <cid>:/tmp/ && docker cp lista.tsv <cid>:/tmp/
 *   docker exec -e TOKEN=... -e LISTA=/tmp/lista.tsv <cid> node /tmp/vincular-lote.js
 *
 * LISTA: TSV sem cabeçalho — data<TAB>placa_ou_chassi<TAB>imei<TAB>tecnico<TAB>local
 * Env:  TOKEN (JWT de ADMIN/OPERATOR), LISTA, DRY_RUN=1 (só consulta, não vincula),
 *       APENAS=IMEI1,IMEI2 (restringe), PAUSA_MS (default 800 — o SGA é lento).
 *
 * Saída: uma linha por item (OK / PULADO / ERRO + motivo) e um resumo no fim.
 * Nunca para no primeiro erro: o objetivo é vincular o máximo e listar o resto.
 */
const fs = require('fs');
const http = require('http');

const TOKEN = process.env.TOKEN;
const LISTA = process.env.LISTA;
const DRY = process.env.DRY_RUN === '1';
const APENAS = (process.env.APENAS || '').split(',').map((s) => s.trim()).filter(Boolean);
const PAUSA = Number(process.env.PAUSA_MS || 800);
const HOST = process.env.API_HOST || 'localhost';
const PORT = Number(process.env.API_PORT || 3001);
if (!TOKEN || !LISTA) {
  console.error('Faltou TOKEN ou LISTA');
  process.exit(2);
}

const ACENTO = { CAUA: 'CAUÃ', ROGERIO: 'ROGÉRIO' };

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: HOST,
        port: PORT,
        method,
        path: '/api/v1' + path,
        headers: {
          Authorization: 'Bearer ' + TOKEN,
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(d); } catch {}
          resolve({ status: res.statusCode, json, raw: d });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const msgDe = (j) => {
  const m = j && (j.message || (j.error && j.error.message) || j.motivo);
  return Array.isArray(m) ? m.join('; ') : m || '';
};

(async () => {
  const linhas = fs
    .readFileSync(LISTA, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [dt, ident, imei, tec, ...resto] = l.split('\t');
      return { dt, ident: (ident || '').trim().toUpperCase(), imei: (imei || '').trim(), tec: (tec || '').trim(), local: resto.join(' ').trim() };
    })
    .filter((r) => r.imei && r.ident)
    .filter((r) => !APENAS.length || APENAS.includes(r.imei));

  console.log(`${linhas.length} item(ns) na lista${DRY ? ' — DRY RUN' : ''}\n`);

  // Estoque disponível uma vez só (paginado), indexado por IMEI.
  const porImei = new Map();
  for (let page = 1; page <= 30; page++) {
    const r = await req('GET', `/stock?perPage=100&page=${page}`);
    if (r.status !== 200 || !r.json) throw new Error(`GET /stock falhou: ${r.status} ${r.raw.slice(0, 200)}`);
    for (const it of r.json.data) porImei.set(it.imei, it);
    if (r.json.data.length < 100) break;
  }
  console.log(`${porImei.size} item(ns) livres no estoque\n`);

  const resumo = { ok: 0, pulado: 0, erro: 0 };
  const erros = [];
  for (const l of linhas) {
    const tag = `${l.imei} ${l.ident.padEnd(17)} ${l.tec.padEnd(8)}`;
    const item = porImei.get(l.imei);
    if (!item) {
      console.log(`PULADO ${tag} — IMEI não está no estoque livre (já vinculado?)`);
      resumo.pulado++;
      continue;
    }

    const lk = await req('GET', `/stock/sga-lookup/${encodeURIComponent(l.ident)}`);
    const look = lk.json && lk.json.data ? lk.json.data : lk.json;
    if (lk.status !== 200 || !look || !look.encontrado) {
      const motivo = (look && look.motivo) || msgDe(lk.json) || `HTTP ${lk.status}`;
      console.log(`ERRO   ${tag} — SGA: ${motivo}`);
      resumo.erro++;
      erros.push({ ...l, motivo });
      await sleep(PAUSA);
      continue;
    }
    if (!look.ativo) {
      const motivo = `veículo ${look.situacao && look.situacao.descricao} no SGA`;
      console.log(`ERRO   ${tag} — ${motivo}`);
      resumo.erro++;
      erros.push({ ...l, motivo });
      await sleep(PAUSA);
      continue;
    }

    if (DRY) {
      console.log(`OK(dry) ${tag} — ${look.fonte || 'sga'}: ${look.cliente.nome} cpf=${look.cliente.cpf}`);
      resumo.ok++;
      await sleep(PAUSA);
      continue;
    }

    const body = {
      placa: l.ident,
      technicianName: ACENTO[l.tec] || l.tec,
      installLocation: l.local || 'não informado',
    };
    const as = await req('POST', `/stock/${item.id}/associate`, body);
    if (as.status >= 200 && as.status < 300) {
      const d = as.json && as.json.data ? as.json.data : as.json;
      console.log(`OK     ${tag} — placa=${d && d.placa} fonte=${look.fonte || 'sga'} cliente=${look.cliente.nome}`);
      resumo.ok++;
    } else {
      const motivo = msgDe(as.json) || `HTTP ${as.status} ${as.raw.slice(0, 120)}`;
      console.log(`ERRO   ${tag} — associate: ${motivo}`);
      resumo.erro++;
      erros.push({ ...l, motivo });
    }
    await sleep(PAUSA);
  }

  console.log(`\nRESUMO: ok=${resumo.ok} pulado=${resumo.pulado} erro=${resumo.erro}`);
  if (erros.length) {
    console.log('\nNÃO VINCULADOS:');
    for (const e of erros) console.log(`  ${e.imei}\t${e.ident}\t${e.tec}\t${e.motivo}`);
  }
})().catch((e) => {
  console.error('FALHA:', e.message);
  process.exit(1);
});
