/**
 * Coleta atributos reais reportados pelos rastreadores em produção via Traccar.
 * Roda em qualquer máquina com acesso ao Traccar (local com tunnel SSH, droplet, ou prod).
 *
 * Output: docs/traccar-attributes-observed.md (Markdown legível) + .json bruto.
 *
 * Uso:
 *   TRACCAR_URL=http://localhost:8082 \
 *   TRACCAR_USER=admin@... \
 *   TRACCAR_PASS=... \
 *   npx ts-node scripts/diagnostics/collect-traccar-attributes.ts
 *
 * Flags:
 *   --limit 100   (default: 50 posições por device)
 *   --hours 24    (default: últimas 24h)
 *   --out docs/traccar-attributes-observed.md
 */

import * as fs from 'fs';
import * as path from 'path';

type Attrs = Record<string, unknown>;

interface DeviceLite {
  id: number;
  uniqueId: string;
  model: string;
  status: string;
}

interface PositionLite {
  deviceId: number;
  protocol: string;
  deviceTime: string;
  attributes: Attrs;
}

interface AttrStats {
  count: number;
  sampleValues: unknown[];
  types: Set<string>;
}

const ARG = (k: string, def: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const TRACCAR_URL = process.env.TRACCAR_URL ?? 'http://localhost:8082';
const TRACCAR_USER = process.env.TRACCAR_USER ?? '';
const TRACCAR_PASS = process.env.TRACCAR_PASS ?? '';
const HOURS = parseInt(ARG('hours', '24'), 10);
const LIMIT = parseInt(ARG('limit', '50'), 10);
const OUT_MD = ARG('out', 'docs/traccar-attributes-observed.md');
const OUT_JSON = OUT_MD.replace(/\.md$/, '.json');

if (!TRACCAR_USER || !TRACCAR_PASS) {
  console.error('TRACCAR_USER e TRACCAR_PASS são obrigatórios.');
  process.exit(1);
}

const authHeader = `Basic ${Buffer.from(`${TRACCAR_USER}:${TRACCAR_PASS}`).toString('base64')}`;

async function api<T>(p: string): Promise<T> {
  const res = await fetch(`${TRACCAR_URL}${p}`, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${p} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchDevices(): Promise<DeviceLite[]> {
  return api<DeviceLite[]>('/api/devices');
}

async function fetchPositions(deviceId: number, from: string, to: string): Promise<PositionLite[]> {
  const qs = `?deviceId=${deviceId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return api<PositionLite[]>(`/api/positions${qs}`);
}

function groupByModel(devices: DeviceLite[]): Map<string, DeviceLite[]> {
  const m = new Map<string, DeviceLite[]>();
  for (const d of devices) {
    const key = (d.model ?? 'UNKNOWN').toUpperCase();
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(d);
  }
  return m;
}

function mergeAttrs(stats: Map<string, AttrStats>, attrs: Attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (!stats.has(k)) stats.set(k, { count: 0, sampleValues: [], types: new Set() });
    const s = stats.get(k)!;
    s.count += 1;
    s.types.add(Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    if (s.sampleValues.length < 5 && !s.sampleValues.some((sv) => JSON.stringify(sv) === JSON.stringify(v))) {
      s.sampleValues.push(v);
    }
  }
}

function renderMarkdown(byModel: Map<string, Map<string, AttrStats>>, totalDevices: number, totalPositions: number): string {
  const lines: string[] = [];
  lines.push('# Atributos observados nos rastreadores em produção');
  lines.push('');
  lines.push(`> Gerado por \`scripts/diagnostics/collect-traccar-attributes.ts\` em ${new Date().toISOString()}.`);
  lines.push(`> Janela: últimas ${HOURS}h. Devices analisados: ${totalDevices}. Posições amostradas: ${totalPositions}.`);
  lines.push('');
  lines.push('## Como ler');
  lines.push('');
  lines.push('- **count** — número de posições em que o atributo apareceu (nessa amostra).');
  lines.push('- **type** — tipos JS observados.');
  lines.push('- **samples** — até 5 valores distintos vistos.');
  lines.push('');

  const sortedModels = [...byModel.keys()].sort();
  for (const model of sortedModels) {
    const stats = byModel.get(model)!;
    const rows = [...stats.entries()].sort((a, b) => b[1].count - a[1].count);
    lines.push(`## ${model}`);
    lines.push('');
    lines.push('| Atributo | count | type | samples |');
    lines.push('|---|---:|---|---|');
    for (const [k, s] of rows) {
      const samples = s.sampleValues.map((v) => '`' + JSON.stringify(v) + '`').join(', ');
      const types = [...s.types].join('/');
      lines.push(`| \`${k}\` | ${s.count} | ${types} | ${samples} |`);
    }
    lines.push('');
  }

  lines.push('## Próximos passos');
  lines.push('');
  lines.push('1. Comparar essa lista com a interface `TraccarPositionAttributes` em `backend/src/modules/traccar/traccar.service.ts`.');
  lines.push('2. Atributos com `count` alto não tipados → adicionar à interface.');
  lines.push('3. Atributos críticos pra antifurto (powerCut, jamming, vibration, alarm) ausentes → revisar configuração Traccar do modelo.');
  return lines.join('\n');
}

(async function main() {
  console.log(`Coletando devices em ${TRACCAR_URL}...`);
  const devices = await fetchDevices();
  console.log(`${devices.length} devices encontrados.`);

  const to = new Date();
  const from = new Date(to.getTime() - HOURS * 3600 * 1000);
  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  const grouped = groupByModel(devices);
  const byModel = new Map<string, Map<string, AttrStats>>();
  let totalPositions = 0;

  for (const [model, list] of grouped) {
    console.log(`\n[${model}] ${list.length} devices`);
    if (!byModel.has(model)) byModel.set(model, new Map());
    const stats = byModel.get(model)!;
    // amostra: até 5 devices por modelo, LIMIT posições por device
    for (const d of list.slice(0, 5)) {
      try {
        const positions = await fetchPositions(d.id, fromISO, toISO);
        const sample = positions.slice(-LIMIT);
        for (const p of sample) {
          mergeAttrs(stats, p.attributes ?? {});
          totalPositions += 1;
        }
        console.log(`  ${d.uniqueId}: ${sample.length} posições`);
      } catch (err) {
        console.warn(`  ${d.uniqueId}: erro ${(err as Error).message}`);
      }
    }
  }

  const md = renderMarkdown(byModel, devices.length, totalPositions);
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_MD, md, 'utf8');

  const json: Record<string, Record<string, { count: number; types: string[]; samples: unknown[] }>> = {};
  for (const [model, stats] of byModel) {
    json[model] = {};
    for (const [k, s] of stats) {
      json[model][k] = { count: s.count, types: [...s.types], samples: s.sampleValues };
    }
  }
  fs.writeFileSync(OUT_JSON, JSON.stringify(json, null, 2), 'utf8');

  console.log(`\nGerado: ${OUT_MD} + ${OUT_JSON}`);
  console.log(`Total posições amostradas: ${totalPositions}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
