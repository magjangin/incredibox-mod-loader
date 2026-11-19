'use strict';

// Shared helpers for the scripts/ tools (import-apk, unpack-apk-mod, build-100p-mod,
// sb3-to-incredimod).
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

// ---------------------------------------------------------------------------
// Incredimod packs: %APPDATA%\Incredibox\incredimods\<versionId>.json + localmods.json
// ---------------------------------------------------------------------------

function toDataURL(buf, mime = 'application/octet-stream') {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function fromDataURL(url) {
  const idx = url.indexOf(',');
  if (idx === -1) throw new Error('Invalid dataURL');
  return Buffer.from(url.slice(idx + 1), 'base64');
}

// app.js colors are sometimes stored without the leading '#'.
function normalizeColor(c, fallback = '#000000') {
  if (!c || typeof c !== 'string') return fallback;
  const trimmed = c.trim();
  return trimmed.startsWith('#') ? trimmed : '#' + trimmed;
}

function getIncredimodsDir() {
  return path.join(process.env.APPDATA, 'Incredibox', 'incredimods');
}

// The game rewrites localmods.json while it runs, so an install made then is lost.
// Windows only; tasklist prints "INFO: No tasks ..." when nothing matches.
function isGameRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Incredibox*', '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
    });
    return /"Incredibox/i.test(out);
  } catch (_) {
    return false;
  }
}

const KEEP_LOCALMODS_BACKUPS = 5;

// Backup time from "localmods.json.bak-<Date.now()>" or the older ISO form
// "localmods.json.bak-2026-11-19T10-20-30-123Z" (build-100p-mod.js before 0.3.0).
function backupTime(file) {
  const suffix = file.slice('localmods.json.bak-'.length);
  if (/^\d+$/.test(suffix)) return Number(suffix);
  const iso = suffix.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, 'T$1:$2:$3.$4Z');
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function pruneLocalmodsBackups(modsDir, keep = KEEP_LOCALMODS_BACKUPS) {
  const baks = fs
    .readdirSync(modsDir)
    .filter((f) => f.startsWith('localmods.json.bak-'))
    .sort((a, b) => backupTime(b) - backupTime(a));
  for (const f of baks.slice(keep)) fs.rmSync(path.join(modsDir, f), { force: true });
  return Math.max(0, baks.length - keep);
}

/**
 * Install a pack and upsert its localmods.json entry.
 *   packFile | packStr  the built pack (a file is copied, a string is written)
 *   entry               { version, name, crew, modders, date, icon, format, size, modio }
 * localmods.json is backed up first (newest KEEP_LOCALMODS_BACKUPS kept). A
 * localmods.json that does not parse is an error: overwriting it would drop
 * every other installed mod.
 */
function installIncredimod({ packFile, packStr, entry, modsDir = getIncredimodsDir() }) {
  fs.mkdirSync(modsDir, { recursive: true });
  const localPath = path.join(modsDir, 'localmods.json');
  let local = [];
  if (fs.existsSync(localPath)) {
    fs.copyFileSync(localPath, `${localPath}.bak-${Date.now()}`);
    local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    if (!Array.isArray(local)) {
      throw new Error(`${localPath} is not a JSON array; fix or remove it first (backup kept).`);
    }
  }
  const idx = local.findIndex((m) => m.version === entry.version);
  if (idx >= 0) local[idx] = entry;
  else local.push(entry);

  const dest = path.join(modsDir, `${entry.version}.json`);
  if (packFile) fs.copyFileSync(packFile, dest);
  else fs.writeFileSync(dest, packStr, 'utf8');
  fs.writeFileSync(localPath, JSON.stringify(local), 'utf8');
  const pruned = pruneLocalmodsBackups(modsDir);
  return { dest, count: local.length, pruned };
}

module.exports = {
  stableVersionId,
  parseAppJs,
  findBandizip,
  findGameDir,
  findModdedDir,
  toDataURL,
  fromDataURL,
  normalizeColor,
  getIncredimodsDir,
  isGameRunning,
  pruneLocalmodsBackups,
  installIncredimod,
};
