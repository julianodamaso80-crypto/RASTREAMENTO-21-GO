/**
 * O Android do react-native-maps usa o Google Maps SDK e cai ao montar o MapView
 * sem chave. A chave não pode ficar literal no app.json (segredo no repo), então
 * entra por variável de ambiente no momento do build.
 */
const carregar = () => {
  jest.resetModules();
  return require('./app.config.js');
};

describe('app.config.js', () => {
  const antes = { ...process.env };
  afterEach(() => {
    process.env = { ...antes };
  });

  it('injeta a chave do Google Maps no Android a partir do ambiente', () => {
    process.env.GOOGLE_MAPS_ANDROID_KEY = 'AIza-teste';
    const cfg = carregar()({ config: { android: { package: 'com.r21go.client' } } });
    expect(cfg.android.config.googleMaps.apiKey).toBe('AIza-teste');
    expect(cfg.android.package).toBe('com.r21go.client');
  });

  it('num build EAS de Android sem a chave, derruba o build em vez de gerar binário que cai', () => {
    delete process.env.GOOGLE_MAPS_ANDROID_KEY;
    process.env.EAS_BUILD = 'true';
    process.env.EAS_BUILD_PLATFORM = 'android';
    expect(() => carregar()({ config: { android: {} } })).toThrow(/GOOGLE_MAPS_ANDROID_KEY/);
  });

  it('fora de build (expo start) sem chave só avisa e segue', () => {
    delete process.env.GOOGLE_MAPS_ANDROID_KEY;
    delete process.env.EAS_BUILD;
    const cfg = carregar()({ config: { android: {} } });
    expect(cfg.android.config.googleMaps.apiKey).toBe('');
  });
});
