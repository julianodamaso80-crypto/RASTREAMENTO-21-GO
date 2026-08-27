/**
 * Complementa o app.json em tempo de build. Só mexe no que não pode ser
 * estático: a chave do Google Maps, que não entra no repositório.
 *
 * As duas plataformas usam o Google Maps SDK. No Android, sem chave o Play
 * Services derruba o processo ao montar o MapView — com sessão salva o app
 * reabre no mapa e cai de novo. No iOS, sem chave o Google devolve mapa
 * cinza. É a MESMA chave nos dois: ela já vinha embutida no app Android
 * publicado, então separar agora não protegeria nada que já não esteja
 * exposto (decisão do dono, 27/08/2026).
 */
module.exports = ({ config }) => {
  const chave = process.env.GOOGLE_MAPS_ANDROID_KEY ?? '';
  const buildNativo = process.env.EAS_BUILD === 'true';

  if (!chave && buildNativo) {
    throw new Error(
      'GOOGLE_MAPS_ANDROID_KEY ausente: build geraria um app com o mapa quebrado.',
    );
  }
  if (!chave) {
    console.warn('[app.config] GOOGLE_MAPS_ANDROID_KEY vazia — mapa não vai renderizar.');
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
    // O plugin do react-native-maps (≥1.22) é o que instala o Google Maps SDK
    // no projeto iOS e grava a GMSApiKey no Info.plist. Sem ele, `provider`
    // Google no iPhone não tem efeito nenhum — o MapView continua MapKit.
    plugins: [
      ...(config.plugins ?? []),
      ['react-native-maps', { iosGoogleMapsApiKey: chave, androidGoogleMapsApiKey: chave }],
    ],
  };
};
