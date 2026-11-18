'use strict';

// Shared helpers for import-apk.js / unpack-apk-mod.js.
// stableVersionId MUST stay byte-for-byte identical: the main-process redirect
// (modloader/main.js) matches `app.html?v=<versionId>` produced by import-apk.js
// against apkmod.json written by unpack-apk-mod.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const GAME_FOLDER = 'Incredibox';
const GAME_EXE = 'Incredibox_steam.exe';

function stableVersionId(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return 9000000 + (Math.abs(hash) % 900000);
}

// Evaluate an APK asset-v*/app.js (`var app = {...}`) in an isolated VM context.
function parseAppJs(appJsPath) {
  const code = fs.readFileSync(appJsPath, 'utf8');
  const sandbox = { app: null };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 2000 });
  if (!sandbox.app) {
    throw new Error(`Failed to evaluate app object from ${appJsPath}`);
  }
  return sandbox.app;
}

function findOnPath(exeName) {
  try {
    const out = execFileSync('where', [exeName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).find((l) => l.trim());
    return first ? first.trim() : null;
  } catch (_) {
    return null;
  }
}

// Bandizip CLI: BANDIZIP env var > standard install dirs > PATH.
function findBandizip() {
  const candidates = [
    process.env.BANDIZIP,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Bandizip', 'bz.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Bandizip', 'bz.exe'),
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p)) || findOnPath('bz.exe');
  if (!found) {
    throw new Error('Bandizip (bz.exe) not found. Install Bandizip or set the BANDIZIP environment variable.');
  }
  return found;
}

function getSteamRoot() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
    return m ? path.normalize(m[1].trim()) : null;
  } catch (_) {
    return null;
  }
}

function getSteamLibraries(steamRoot) {
  const libs = [steamRoot];
  const vdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  if (fs.existsSync(vdf)) {
    const text = fs.readFileSync(vdf, 'utf8');
    for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
      libs.push(path.normalize(m[1].replace(/\\\\/g, '\\')));
    }
  }
  return [...new Set(libs.map((p) => p.toLowerCase()))].map(
    (lower) => libs.find((p) => p.toLowerCase() === lower)
  );
}

// Incredibox install dir: INCREDIBOX_DIR env var > Steam libraries.
function findGameDir() {
  if (process.env.INCREDIBOX_DIR && fs.existsSync(process.env.INCREDIBOX_DIR)) {
    return path.resolve(process.env.INCREDIBOX_DIR);
  }
  const steamRoot = getSteamRoot();
  if (steamRoot) {
    for (const lib of getSteamLibraries(steamRoot)) {
      const dir = path.join(lib, 'steamapps', 'common', GAME_FOLDER);
      if (fs.existsSync(path.join(dir, GAME_EXE))) return dir;
    }
  }
  return null;
}

function findModdedDir() {
  const gameDir = findGameDir();
  return gameDir ? path.join(gameDir, 'Modded') : null;
}

module.exports = {
  stableVersionId,
  parseAppJs,
  findBandizip,
  findGameDir,
  findModdedDir,
};
