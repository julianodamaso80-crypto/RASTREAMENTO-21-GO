/**
 * Complementa o app.json em tempo de build. Só mexe no que não pode ser
 * estático: a chave do Google Maps do Android (react-native-maps no Android
 * usa o Google Maps SDK; sem chave o Play Services derruba o processo ao
 * montar o MapView — com sessão salva o app reabre no mapa e cai de novo).
 * iOS usa Apple Maps e não precisa de nada.
 */
module.exports = ({ config }) => {
  const chave = process.env.GOOGLE_MAPS_ANDROID_KEY ?? '';
  const buildAndroid =
    process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PLATFORM === 'android';

  if (!chave && buildAndroid) {
    throw new Error(
      'GOOGLE_MAPS_ANDROID_KEY ausente: build Android geraria um app que cai ao abrir o mapa.',
    );
  }
  if (!chave) {
    console.warn('[app.config] GOOGLE_MAPS_ANDROID_KEY vazia — mapa Android não vai renderizar.');
  }

  return {
    ...config,
    android: {
      ...config.android,
      config: {
        ...(config.android?.config ?? {}),
        googleMaps: { apiKey: chave },
      },
    },
  };
};
