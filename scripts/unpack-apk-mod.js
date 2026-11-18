'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const BANDIZIP = 'C:\\Program Files\\Bandizip\\bz.exe';
const DEFAULT_MODDED_DIR = 'H:\\steam\\steamapps\\common\\Incredibox\\Modded';

function stableVersionId(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return 9000000 + (Math.abs(hash) % 900000);
}

function parseAppJs(appJsPath) {
  const code = fs.readFileSync(appJsPath, 'utf8');
  const sandbox = { app: null };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 2000 });
  return sandbox.app;
}

function main() {
  const defaultApk = path.join(process.env.USERPROFILE, 'Downloads', 'Incredibox.apk');
  const apkPath = path.resolve(process.argv[2] || defaultApk);
  const moddedDir = path.resolve(process.argv[3] || DEFAULT_MODDED_DIR);

  if (!fs.existsSync(apkPath)) {
    console.error(`APK not found: ${apkPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(BANDIZIP)) {
    console.error(`Bandizip not found: ${BANDIZIP}`);
    process.exit(1);
  }

  const tempExtract = path.join(process.env.TEMP, 'incredibox_apk_www');
  fs.rmSync(tempExtract, { recursive: true, force: true });
  fs.mkdirSync(tempExtract, { recursive: true });

  console.log(`Extracting assets/www from ${apkPath}...`);
  execFileSync(BANDIZIP, ['x', '-y', '-r', `-o:${tempExtract}`, apkPath, 'assets\\www\\*'], {
    stdio: 'inherit',
  });

  const wwwSrc = path.join(tempExtract, 'assets', 'www');
  if (!fs.existsSync(wwwSrc)) {
    console.error('assets/www not found in APK.');
    process.exit(1);
  }

  // Detect mod name from asset-v1/app.js or APK filename
  let modName = path.basename(apkPath, path.extname(apkPath));
  let characters = 0;
  let nbpolo = 7;
  const appJsPath = path.join(wwwSrc, 'asset-v1', 'app.js');
  if (fs.existsSync(appJsPath)) {
    try {
      const appObj = parseAppJs(appJsPath);
      if (appObj && appObj.name) modName = appObj.name;
      if (appObj && Array.isArray(appObj.animearray)) characters = appObj.animearray.length;
      if (appObj && appObj.nbpolo) nbpolo = appObj.nbpolo;
    } catch (_) {
      // Fallback to filename
    }
  }

  const safeFolder = modName.replace(/[<>:"/\\|?*]+/g, '_');
  const destRoot = path.join(moddedDir, 'ApkMods', safeFolder);
  const destWww = path.join(destRoot, 'www');
  fs.rmSync(destRoot, { recursive: true, force: true });
  fs.mkdirSync(destRoot, { recursive: true });
  fs.cpSync(wwwSrc, destWww, { recursive: true });

  // Raise built-in recording limit in asset-v*/app.js to effectively unlimited (~160+ min / 999 loops)
  for (const entry of fs.readdirSync(destWww, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^asset-v\d+$/i.test(entry.name)) continue;
    const vAppJs = path.join(destWww, entry.name, 'app.js');
    if (!fs.existsSync(vAppJs)) continue;
    let code = fs.readFileSync(vAppJs, 'utf8');
    const targetLoops = 999;
    code = code.replace(/(this\.recmaxloop\s*=\s*)\d+/g, (_, prefix) => `${prefix}${targetLoops}`);
    fs.writeFileSync(vAppJs, code, 'utf8');
  }

  // Disable Android cordova.js bridge so desktop Electron uses DOMContentLoaded cleanly
  const cordovaPath = path.join(destWww, 'cordova.js');
  if (fs.existsSync(cordovaPath)) {
    fs.writeFileSync(cordovaPath, '// Disabled for desktop Electron playback\n', 'utf8');
  }

  const meta = {
    name: modName,
    versionId: stableVersionId(modName),
    characters,
    nbpolo,
    entry: fs.existsSync(path.join(destWww, 'app.html')) ? 'app.html?v=1' : 'index.html',
    sourceApk: path.basename(apkPath),
  };
  fs.writeFileSync(path.join(destRoot, 'apkmod.json'), JSON.stringify(meta, null, 2), 'utf8');

  fs.rmSync(tempExtract, { recursive: true, force: true });
  console.log(`Unpacked APK mod "${modName}" (${characters} chars, ${nbpolo} polos) -> ${destRoot}`);
}

if (require.main === module) {
  main();
}
