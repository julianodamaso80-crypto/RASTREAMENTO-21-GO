// Mock do react-native-maps SÓ pro web (o componente é nativo, não roda em navegador).
// Usado apenas pra testar o fluxo de navegação no navegador; NÃO afeta iOS/Android.
const React = require('react');
const { View } = require('react-native');
function Noop(props) { return React.createElement(View, props, props.children || null); }
module.exports = Noop;
module.exports.default = Noop;
module.exports.Marker = Noop;
module.exports.Polyline = Noop;
module.exports.UrlTile = Noop;
