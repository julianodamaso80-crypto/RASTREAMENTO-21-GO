// Prebuild iOS não roda no Windows, então a única forma barata de saber se o
// plugin acerta o AppDelegate e o Podfile é testar as transformações puras.
// Os dois fixtures abaixo são os templates reais do Expo SDK 54.
const {
  aplicarImport,
  aplicarInit,
  aplicarPodfile,
} = require('./with-google-maps-ios');

const APP_DELEGATE = [
  'import Expo',
  'import React',
  'import ReactAppDependencyProvider',
  '',
  '@UIApplicationMain',
  'public class AppDelegate: ExpoAppDelegate {',
  '  var window: UIWindow?',
  '',
  '  public override func application(',
  '    _ application: UIApplication,',
  '    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil',
  '  ) -> Bool {',
  '    let delegate = ReactNativeDelegate()',
  '    return super.application(application, didFinishLaunchingWithOptions: launchOptions)',
  '  }',
  '}',
  '',
].join('\n');

// O `use_native_modules!` do Expo recebe o config_command do autolinking dele.
// Foi exatamente esse argumento que a primeira versão do plugin decapitou,
// derrubando o build 36.
const PODFILE = [
  "require File.join(File.dirname(`node --print \"require.resolve('expo/package.json')\"`), \"scripts/autolinking\")",
  '',
  "target 'r21goclient' do",
  '  use_expo_modules!',
  '',
  '  config_command = [',
  "    'node',",
  "    '--no-warnings',",
  "    '--eval',",
  "    'react-native-config',",
  '  ]',
  '',
  '  config = use_native_modules!(config_command)',
  '',
  '  use_react_native!(',
  '    :path => config[:reactNativePath]',
  '  )',
  'end',
  '',
].join('\n');

describe('with-google-maps-ios', () => {
  it('importa o GoogleMaps logo depois do Expo', () => {
    const out = aplicarImport(APP_DELEGATE);
    expect(out).toContain('import GoogleMaps');
    expect(out.indexOf('import Expo')).toBeLessThan(out.indexOf('import GoogleMaps'));
  });

  it('chama provideAPIKey ANTES do super — exigência do SDK', () => {
    const out = aplicarInit(APP_DELEGATE, 'CHAVE123');
    expect(out).toContain('GMSServices.provideAPIKey("CHAVE123")');
    expect(out.indexOf('provideAPIKey')).toBeLessThan(
      out.indexOf('super.application(application'),
    );
  });

  it('mantém a indentação do método ao injetar', () => {
    const out = aplicarInit(APP_DELEGATE, 'K');
    expect(out).toContain('    GMSServices.provideAPIKey("K")');
  });

  it('não quebra a linha do return ao inserir antes dela', () => {
    const out = aplicarInit(APP_DELEGATE, 'K');
    expect(out).toContain(
      '    return super.application(application, didFinishLaunchingWithOptions: launchOptions)',
    );
  });

  it('não duplica quando o prebuild roda de novo', () => {
    const umaVez = aplicarInit(aplicarImport(APP_DELEGATE), 'K');
    const duasVezes = aplicarInit(aplicarImport(umaVez), 'K');
    expect(duasVezes).toBe(umaVez);
  });

  it('adiciona o pod do Google Maps depois do use_native_modules!', () => {
    const out = aplicarPodfile(PODFILE);
    expect(out).toContain("pod 'react-native-google-maps', :path => rn_maps_path");
    expect(out.indexOf('use_native_modules!')).toBeLessThan(
      out.indexOf('react-native-google-maps'),
    );
  });

  it('não duplica o pod', () => {
    expect(aplicarPodfile(aplicarPodfile(PODFILE))).toBe(aplicarPodfile(PODFILE));
  });

  /*
   * O bug que derrubou o build 36: inserir logo depois do TEXTO
   * "use_native_modules!" separava a chamada do seu argumento e o
   * "(config_command)" sobrava numa linha solta. O autolinking do Expo era
   * ignorado, o Ruby caía no @react-native-community/cli e o pod install
   * morria com "Invalid Podfile file: exit".
   */
  it('preserva o argumento do use_native_modules!', () => {
    const out = aplicarPodfile(PODFILE);
    expect(out).toContain('config = use_native_modules!(config_command)');
    expect(out).not.toMatch(/^\s*\(config_command\)\s*$/m);
  });

  it('insere o pod na linha seguinte, mantendo a indentação do bloco', () => {
    const linhas = aplicarPodfile(PODFILE).split('\n');
    const i = linhas.findIndex((l) => l.includes('use_native_modules!'));
    expect(linhas[i + 1]).toBe('  # r21go: Google Maps iOS');
    expect(linhas[i + 3]).toContain("  pod 'react-native-google-maps'");
  });

  /*
   * O build custa 40 minutos de runner macOS. Se o template do Expo mudar, o
   * certo é quebrar no prebuild com mensagem clara, não gerar um app com mapa
   * cinza que só aparece na mão do associado.
   */
  it('explode se a âncora do AppDelegate sumir', () => {
    expect(() => aplicarImport('import Foundation\n')).toThrow(/import Expo/);
    expect(() => aplicarInit('class X {}', 'K')).toThrow(/super.application/);
  });

  it('explode se a âncora do Podfile sumir', () => {
    expect(() => aplicarPodfile("target 'x' do\nend\n")).toThrow(/use_native_modules/);
  });
});
