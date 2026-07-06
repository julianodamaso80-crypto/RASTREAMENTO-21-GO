// Config plugin Expo (SDK 56) — injeta pings NATIVOS de boot + CAIXA-PRETA no
// AppDelegate.swift. Objetivo: observar SEM cabo USB onde o boot iOS para.
//
// Duas camadas de diagnostico:
//  1) Pings nativos (N1/N2/N3) rodam ANTES do JavaScript -> dizem se o processo
//     chega ao AppDelegate, sobrevive (hang vs morte) e ate onde vai.
//  2) Caixa-preta (watchdog): o nativo zera a flag "r21goJsBooted"; o JS (diag.ts,
//     evento 01-module-loaded) marca true via RN Settings (NSUserDefaults). Aos 25s,
//     se a flag continuar false (JS nunca subiu), o app CRASHA de proposito
//     (fatalError) -> o iOS grava um relatorio .ips COMPLETO com todas as threads,
//     revelando onde o runtime RN/Expo ficou preso. O ping N4 e sincrono (semaforo
//     ate 3s) pra sair ANTES do crash.
//
// Regras: SOMENTE Foundation. Nunca crasha por acidente (so o fatalError proposital).
// applyDiag e pura e testavel sem prebuild iOS (impossivel no Windows). Se qualquer
// ancora sumir, LANCA erro -> o build falha rapido no prebuild da nuvem.
const { withAppDelegate } = require('@expo/config-plugins');

const BUILD = '19';

// import Foundation + helpers fileprivate (assincrono e sincrono).
const IMPORT_AND_HELPER = `import Foundation

// ---- r21go native boot diag (build ${BUILD}) — SOMENTE Foundation ----
fileprivate func r21goNativeDiag(_ event: String) {
  let ts = String(Int(Date().timeIntervalSince1970 * 1000))
  guard let url = URL(string: "https://api.trackgo.site/diag?e=\\(event)&b=${BUILD}&t=\\(ts)") else { return }
  URLSession.shared.dataTask(with: url) { _, _, _ in }.resume()
}
// versao SINCRONA (bloqueia ate 3s) — garante que o ping sai ANTES do crash proposital
fileprivate func r21goNativeDiagSync(_ event: String) {
  let ts = String(Int(Date().timeIntervalSince1970 * 1000))
  guard let url = URL(string: "https://api.trackgo.site/diag?e=\\(event)&b=${BUILD}&t=\\(ts)") else { return }
  let sem = DispatchSemaphore(value: 0)
  URLSession.shared.dataTask(with: url) { _, _, _ in sem.signal() }.resume()
  _ = sem.wait(timeout: .now() + 3)
}
// ---- fim r21go native boot diag ----
`;

// Inicio do didFinishLaunching: N1 + reset da flag + N3 (prova de vida 8s) +
// watchdog de 25s (caixa-preta: crash proposital se o JS nunca subir).
const BODY_START = `// r21go native boot diag (build ${BUILD}): pings nativos + caixa-preta (crash proposital)
    r21goNativeDiag("N1-didFinishLaunching-start")
    UserDefaults.standard.set(false, forKey: "r21goJsBooted")
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
      r21goNativeDiag("N3-alive-8s")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
      if UserDefaults.standard.bool(forKey: "r21goJsBooted") == false {
        r21goNativeDiagSync("N4-watchdog-js-never-started")
        fatalError("R21GO_DIAG_BUILD${BUILD}: JS nao iniciou em 25s - boot hang nativo (caixa-preta proposital)")
      }
    }`;

// Ultima linha antes do return final do didFinishLaunching.
const N2 = `// r21go native boot diag: fim do didFinishLaunching
    r21goNativeDiag("N2-didFinishLaunching-end")`;

const ANCHOR_CLASS = '@main';
const ANCHOR_BODY = 'let delegate = ReactNativeDelegate()';
const ANCHOR_RETURN = 'return super.application(application, didFinishLaunchingWithOptions: launchOptions)';

// Transformacao pura: recebe o AppDelegate.swift, devolve com pings + caixa-preta.
function applyDiag(contents) {
  if (contents.includes('r21goNativeDiag')) {
    return contents; // idempotente
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
  out = out.replace(ANCHOR_BODY, `${BODY_START}\n    ${ANCHOR_BODY}`);
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
