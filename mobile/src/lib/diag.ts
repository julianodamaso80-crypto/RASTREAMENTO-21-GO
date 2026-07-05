// Rastreador de boot (diagnóstico temporário). Avisa o backend em cada etapa
// do boot pra sabermos, pelos logs do servidor, até onde o JS executa no device.
// Fire-and-forget, nunca lança.
const BUILD = '17';

export function diag(event: string) {
  try {
    fetch(
      `https://api.trackgo.site/diag?e=${encodeURIComponent(event)}&b=${BUILD}&t=${Date.now()}`,
    ).catch(() => {});
  } catch {
    // ignora
  }
}
