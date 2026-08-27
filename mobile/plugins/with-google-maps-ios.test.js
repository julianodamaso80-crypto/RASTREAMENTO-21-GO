// Prebuild iOS não roda no Windows, então a única forma barata de saber se o
// plugin acerta o AppDelegate é testar as transformações puras. O AppDelegate
// abaixo é o template real do Expo SDK 54.
const {
  aplicarImport,
  aplicarInit,
  aplicarPodfile,
} = require('./with-google-maps-ios');

const APP_DELEGATE = `import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

const PODFILE = `require File.join(File.dirname(\`node --print "require.resolve('expo/package.json')"\`), "scripts/autolinking")

target 'r21goclient' do
  use_expo_modules!
  config = use_native_modules!

  use_react_native!(
    :path => config[:reactNativePath]
  )
end
`;

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
