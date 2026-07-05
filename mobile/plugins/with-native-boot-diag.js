// Config plugin Expo (SDK 56) — injeta pings NATIVOS de boot no AppDelegate.swift.
// Objetivo: observar SEM cabo USB onde o boot iOS para. O codigo nativo roda ANTES
// do JavaScript, entao um unico build responde se o processo chega ao AppDelegate,
// se sobrevive (hang vs morte) e se o runtime RN sobe.
//
// Regras: SOMENTE Foundation (nada de React Native). Fire-and-forget. Nunca crasha.
// A funcao de transformacao (applyDiag) e pura e testavel sem prebuild iOS (impossivel
// no Windows). Se qualquer ancora sumir, LANCA erro -> o build falha rapido no prebuild
// da nuvem em vez de gerar um build inutil.
const { withAppDelegate } = require('@expo/config-plugins');

const BUILD = '17';

// import Foundation (garante URL/URLSession/Date/DispatchQueue) + helper fileprivate.
const IMPORT_AND_HELPER = `import Foundation

// ---- r21go native boot diag (build ${BUILD}) — SOMENTE Foundation, fire-and-forget ----
fileprivate func r21goNativeDiag(_ event: String) {
  let ts = String(Int(Date().timeIntervalSince1970 * 1000))
  guard let url = URL(string: "https://api.trackgo.site/diag?e=\\(event)&b=${BUILD}&t=\\(ts)") else { return }
  URLSession.shared.dataTask(with: url) { _, _, _ in }.resume()
}
// ---- fim r21go native boot diag ----
`;

// N1 (primeira linha do didFinishLaunching) + N3 (prova de vida em 8s: se chegar,
// o processo continua vivo = hang, nao morte).
const N1_N3 = `// r21go native boot diag: inicio do didFinishLaunching + prova de vida em 8s
    r21goNativeDiag("N1-didFinishLaunching-start")
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
      r21goNativeDiag("N3-alive-8s")
    }`;

// N2 (ultima linha antes do return final do didFinishLaunching).
const N2 = `// r21go native boot diag: fim do didFinishLaunching
    r21goNativeDiag("N2-didFinishLaunching-end")`;

const ANCHOR_CLASS = '@main';
const ANCHOR_BODY = 'let delegate = ReactNativeDelegate()';
const ANCHOR_RETURN = 'return super.application(application, didFinishLaunchingWithOptions: launchOptions)';

// Transformacao pura: recebe o conteudo do AppDelegate.swift, devolve com os pings.
function applyDiag(contents) {
  if (contents.includes('r21goNativeDiag')) {
    return contents; // idempotente — nao injeta duas vezes
  }
  if (!contents.includes(ANCHOR_CLASS)) {
    throw new Error('[with-native-boot-diag] ancora "@main" nao encontrada no AppDelegate.swift');
  }
  if (!contents.includes(ANCHOR_BODY)) {
    throw new Error('[with-native-boot-diag] ancora do corpo (let delegate = ReactNativeDelegate()) nao encontrada');
  }
  if (!contents.includes(ANCHOR_RETURN)) {
    throw new Error('[with-native-boot-diag] ancora do return final do didFinishLaunching nao encontrada');
  }
  let out = contents;
  out = out.replace(ANCHOR_CLASS, `${IMPORT_AND_HELPER}\n${ANCHOR_CLASS}`);
  out = out.replace(ANCHOR_BODY, `${N1_N3}\n    ${ANCHOR_BODY}`);
  out = out.replace(ANCHOR_RETURN, `${N2}\n    ${ANCHOR_RETURN}`);
  return out;
}

const withNativeBootDiag = (config) => {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error(`[with-native-boot-diag] esperava AppDelegate Swift (SDK 56), veio: ${cfg.modResults.language}`);
    }
    cfg.modResults.contents = applyDiag(cfg.modResults.contents);
    return cfg;
  });
};

module.exports = withNativeBootDiag;
module.exports.applyDiag = applyDiag; // exportado para teste sem prebuild
