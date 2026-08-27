// Config plugin Expo — liga o Google Maps no iOS mantendo react-native-maps
// 1.20.1 e a arquitetura LEGADA.
//
// Por que caseiro, se a lib tem plugin oficial: o plugin oficial só existe da
// 1.22 pra frente, e da 1.21 em diante a lib é New-Architecture-first — os
// .mm do Fabric são compilados sempre, e sem os headers gerados o build morre
// em "cannot find interface declaration for 'RNMapsMarkerView'" (medido no
// build 35, 27/08/2026). Ligar a New Arch é justamente o que deixou o app com
// tela branca no iOS 26. Então fica a 1.20.1, que compila, e este arquivo faz
// o que o plugin oficial faria: chave no Info.plist, pod do Google Maps e
// GMSServices no AppDelegate.
//
// As três transformações são funções PURAS de string, exportadas e testadas em
// with-google-maps-ios.test.js — prebuild iOS é impossível no Windows, então a
// única forma de errar barato é essa. Se qualquer âncora sumir, o plugin LANÇA
// e o build quebra no prebuild, não no Xcode 40 minutos depois.
const fs = require('fs');
const path = require('path');
const {
  withInfoPlist,
  withAppDelegate,
  withDangerousMod,
} = require('@expo/config-plugins');

// Mesma âncora do plugin oficial: a chamada de super no didFinishLaunching.
const ANCORA_INIT = /\bsuper\.application\(\w+?, didFinishLaunchingWithOptions: \w+?\)/;
const ANCORA_IMPORT = /^import Expo$/m;
const ANCORA_PODFILE = /use_native_modules!/;

const MARCA_IMPORT = '// r21go: Google Maps iOS';
const MARCA_INIT = '// r21go: GMSServices';
const MARCA_POD = '# r21go: Google Maps iOS';

/** `import GoogleMaps` logo abaixo do import do Expo. */
function aplicarImport(src) {
  if (src.includes(MARCA_IMPORT)) return src;
  if (!ANCORA_IMPORT.test(src)) {
    throw new Error(
      '[with-google-maps-ios] "import Expo" não encontrado no AppDelegate.swift — ' +
        'o template do Expo mudou e o plugin precisa ser revisto.',
    );
  }
  return src.replace(
    ANCORA_IMPORT,
    `import Expo\n${MARCA_IMPORT}\nimport GoogleMaps`,
  );
}

/**
 * `GMSServices.provideAPIKey` ANTES do super — a doc do SDK exige que seja a
 * primeira coisa do didFinishLaunching, senão o mapa sobe cinza.
 */
function aplicarInit(src, apiKey) {
  if (src.includes(MARCA_INIT)) return src;
  const m = src.match(ANCORA_INIT);
  if (!m) {
    throw new Error(
      '[with-google-maps-ios] super.application(...didFinishLaunchingWithOptions...) ' +
        'não encontrado no AppDelegate.swift — âncora do plugin quebrou.',
    );
  }
  const linha = src.slice(0, m.index).split('\n').pop();
  const indent = (linha.match(/^\s*/) || [''])[0];
  const bloco =
    `${indent}${MARCA_INIT}\n` +
    `${indent}GMSServices.provideAPIKey("${apiKey}")\n`;
  const inicioDaLinha = m.index - linha.length;
  return src.slice(0, inicioDaLinha) + bloco + src.slice(inicioDaLinha);
}

/**
 * O pod `react-native-google-maps` não é autolinkado (é um segundo podspec
 * dentro do mesmo pacote), então entra na mão. Ele traz GoogleMaps 8.4.0 e
 * define HAVE_GOOGLE_MAPS=1.
 */
function aplicarPodfile(src) {
  if (src.includes(MARCA_POD)) return src;
  if (!ANCORA_PODFILE.test(src)) {
    throw new Error(
      '[with-google-maps-ios] use_native_modules! não encontrado no Podfile.',
    );
  }
  const pod =
    `  ${MARCA_POD}\n` +
    "  rn_maps_path = File.dirname(`node --print \"require.resolve('react-native-maps/package.json')\"`)\n" +
    "  pod 'react-native-google-maps', :path => rn_maps_path\n";
  return src.replace(ANCORA_PODFILE, (match) => `${match}\n${pod}`);
}

function withGoogleMapsIOS(config, { apiKey } = {}) {
  if (!apiKey) return config;

  config = withInfoPlist(config, (c) => {
    c.modResults.GMSApiKey = apiKey;
    return c;
  });

  config = withAppDelegate(config, (c) => {
    c.modResults.contents = aplicarInit(
      aplicarImport(c.modResults.contents),
      apiKey,
    );
    return c;
  });

  config = withDangerousMod(config, [
    'ios',
    (c) => {
      const podfile = path.join(c.modRequest.platformProjectRoot, 'Podfile');
      fs.writeFileSync(
        podfile,
        aplicarPodfile(fs.readFileSync(podfile, 'utf8')),
      );
      return c;
    },
  ]);

  return config;
}

module.exports = withGoogleMapsIOS;
module.exports.aplicarImport = aplicarImport;
module.exports.aplicarInit = aplicarInit;
module.exports.aplicarPodfile = aplicarPodfile;
