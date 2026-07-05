// Rastreador de boot (diagnóstico temporário). Avisa o backend em cada etapa
// do boot pra sabermos, pelos logs do servidor, até onde o JS executa no device.
// Fire-and-forget, nunca lança.
import { Settings } from 'react-native';

const BUILD = '18';

export function diag(event: string) {
  // Sinal de vida do JS pra camada NATIVA (NSUserDefaults via RN Settings, iOS).
  // A caixa-preta nativa (watchdog de 25s no AppDelegate) só NÃO crasha o app se
  // essa flag virar true — ou seja, se o JS realmente começou a executar.
  if (event === '01-module-loaded') {
    try {
      Settings.set({ r21goJsBooted: true });
    } catch {
      // ignora — em plataformas sem Settings (web/android) é no-op
    }
  }
  try {
    fetch(
      `https://api.trackgo.site/diag?e=${encodeURIComponent(event)}&b=${BUILD}&t=${Date.now()}`,
    ).catch(() => {});
  } catch {
    // ignora
  }
}
