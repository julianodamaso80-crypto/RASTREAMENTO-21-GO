const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
// Só no WEB: troca react-native-maps (nativo) por um mock, pra permitir testar
// o fluxo de navegação no navegador. iOS/Android usam a lib real normalmente.
const orig = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-maps') {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/lib/maps-mock.web.js') };
  }
  return (orig || context.resolveRequest)(context, moduleName, platform);
};
module.exports = config;
