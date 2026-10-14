// Posições reais para os devices do associado A, pelo protocolo osmand do
// Traccar do runner (nunca rodar contra produção). Só Node 22, sem deps.
//
// Uso: node semear-posicoes.mjs
// Env: HOMOLOG_FIXTURE (do semear-frota.mjs), TRACCAR_API_URL,
//      TRACCAR_ADMIN_EMAIL, TRACCAR_ADMIN_PASSWORD,
//      TRACCAR_OSMAND_URL (padrão http://localhost:5055, porta do osmand no
//      docker/traccar/traccar.xml e na imagem padrão).
//
// Sai com código 1 se algum device não tiver a posição lida de volta pela API.

import { readFileSync } from 'node:fs';

const env = (nome, padrao) => {
  const v = process.env[nome] ?? padrao;
  if (v === undefined || v === '') throw new Error(`Variável ${nome} ausente`);
  return v;
};

const TRACCAR_API = env('TRACCAR_API_URL', 'http://localhost:8082/api').replace(/\/$/, '');
const OSMAND = env('TRACCAR_OSMAND_URL', 'http://localhost:5055').replace(/\/$/, '');
const AUTH =
  'Basic ' + Buffer.from(`${env('TRACCAR_ADMIN_EMAIL')}:${env('TRACCAR_ADMIN_PASSWORD')}`).toString('base64');
const fx = JSON.parse(readFileSync(env('HOMOLOG_FIXTURE'), 'utf8'));

const dispositivos = fx.associadoA?.dispositivos ?? [];
if (dispositivos.length < 2) {
  console.error(`::error::fixture com ${dispositivos.length} device(s) do associado A; preciso de 2`);
  process.exit(1);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function enviar(d, i) {
  const params = new URLSearchParams({
    id: d.uniqueId,
    lat: String(-22.9 - i / 100),
    lon: String(-43.2 - i / 100),
    timestamp: String(Math.floor(Date.now() / 1000)),
    speed: String(20 + i * 10),
    ignition: 'true',
  });
  const res = await fetch(`${OSMAND}/?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`osmand respondeu ${res.status} para ${d.uniqueId}`);
}

async function lerPosicao(deviceId) {
  const res = await fetch(`${TRACCAR_API}/positions?deviceId=${deviceId}`, {
    headers: { authorization: AUTH, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const lista = await res.json();
  return Array.isArray(lista) && lista.length > 0 ? lista[0] : null;
}

let falhou = false;
for (const [i, d] of dispositivos.entries()) {
  await enviar(d, i);
  let posicao = null;
  for (let t = 0; t < 30 && !posicao; t++) {
    posicao = await lerPosicao(d.deviceId);
    if (!posicao) await espera(1_000);
  }
  if (!posicao) {
    console.error(`::error::device ${d.deviceId} (${d.placa}) sem posição na API do Traccar após 30 s`);
    falhou = true;
    continue;
  }
  console.log(
    `OK device ${d.deviceId} (${d.placa}): lat=${posicao.latitude} lon=${posicao.longitude} speed=${posicao.speed} ignition=${posicao.attributes?.ignition}`,
  );
}
process.exit(falhou ? 1 : 0);
