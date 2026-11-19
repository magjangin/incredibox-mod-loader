'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain } = require('electron');

const LOADER_VERSION = '0.2.0';

// Preserve original console methods before obfuscated elec-index.js overwrites them.
const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function getGameRoot() {
  return path.dirname(app.getPath('exe'));
}

function getModsDir() {
  return path.join(getGameRoot(), 'Mods');
}

function getApkModsDir() {
  return path.join(getGameRoot(), 'ApkMods');
}

function createLogger() {
  const logs = [];
  let logFile = null;

  function write(level, msg) {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
    logs.push(line);
    rawConsole.log(line);
    if (!logFile) {
      // First write of this session: rotate the previous log so the file never grows unbounded.
      try {
        const modsDir = getModsDir();
        fs.mkdirSync(modsDir, { recursive: true });
        logFile = path.join(modsDir, 'modloader.log');
        if (fs.existsSync(logFile)) {
          fs.renameSync(logFile, path.join(modsDir, 'modloader.prev.log'));
        }
      } catch (_) {
        if (!logFile) return;
      }
    }
    try {
      fs.appendFileSync(logFile, line + '\n', 'utf8');
    } catch (_) {
      // Ignore file write errors
    }
  }

  return {
    info: (msg) => write('INFO', msg),
    warn: (msg) => write('WARN', msg),
    error: (msg) => write('ERROR', msg),
    getLogs: () => logs.slice(),
  };
}

const logger = createLogger();

function discoverMods() {
  const modsDir = getModsDir();
  if (!fs.existsSync(modsDir)) {
    fs.mkdirSync(modsDir, { recursive: true });
    return [];
  }

  const entries = fs.readdirSync(modsDir, { withFileTypes: true });
  const mods = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    const modDir = path.join(modsDir, entry.name);
    const manifestPath = path.join(modDir, 'mod.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.enabled === false) {
        logger.info(`Skipping disabled mod: ${entry.name}`);
        continue;
      }
      mods.push({
        id: manifest.id || entry.name,
        name: manifest.name || entry.name,
        version: manifest.version || '1.0.0',
        author: manifest.author || 'Unknown',
        description: manifest.description || '',
        dir: modDir,
        main: manifest.main || null,
        renderer: manifest.renderer || null,
        css: manifest.css || null,
      });
    } catch (err) {
      logger.error(`Failed to parse ${manifestPath}: ${err.message}`);
    }
  }

  return mods;
}

function discoverApkMods() {
  const apkModsDir = getApkModsDir();
  if (!fs.existsSync(apkModsDir)) {
    return [];
  }

  const entries = fs.readdirSync(apkModsDir, { withFileTypes: true });
  const apkMods = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const modDir = path.join(apkModsDir, entry.name);
    const metaPath = path.join(modDir, 'apkmod.json');
    const wwwDir = path.join(modDir, 'www');
    if (!fs.existsSync(metaPath) || !fs.existsSync(wwwDir)) continue;

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const entryRel = meta.entry || 'app.html?v=1';
      const [entryFile, query] = entryRel.split('?');
      const entryAbs = path.join(wwwDir, entryFile);
      if (!fs.existsSync(entryAbs)) continue;

      const entryUrl = pathToFileURL(entryAbs).href + (query ? `?${query}` : '');
      apkMods.push({
        id: entry.name,
        name: meta.name || entry.name,
        versionId: meta.versionId || null,
        characters: meta.characters || 0,
        nbpolo: meta.nbpolo || 7,
        entryUrl,
        // main-process only (not sent to the renderer)
        dir: modDir,
        wwwBaseUrl: pathToFileURL(wwwDir).href.replace(/\/?$/, '/'),
      });
    } catch (err) {
      logger.error(`Failed to parse ${metaPath}: ${err.message}`);
    }
  }

  return apkMods;
}

const loadedMods = discoverMods();
const apkMods = discoverApkMods();
logger.info(
  `Incredibox ModLoader v${LOADER_VERSION} starting. Found ${loadedMods.length} JS mod(s), ${apkMods.length} APK mod(s).`
);

for (const mod of loadedMods) {
  if (!mod.main) continue;
  const mainPath = path.join(mod.dir, mod.main);
  if (!fs.existsSync(mainPath)) {
    logger.warn(`[${mod.id}] Missing main script: ${mainPath}`);
    continue;
  }
  try {
    const modExports = require(mainPath);
    if (typeof modExports === 'function') {
      modExports({ app, BrowserWindow, ipcMain, logger, mod, loaderVersion: LOADER_VERSION });
    }
    logger.info(`[${mod.id}] Loaded main script.`);
  } catch (err) {
    logger.error(`[${mod.id}] Main script error: ${err.stack || err.message}`);
  }
}

function buildRendererPayload() {
  return loadedMods.map((mod) => {
    let rendererCode = null;
    let cssCode = null;

    if (mod.renderer) {
      const rPath = path.join(mod.dir, mod.renderer);
      if (fs.existsSync(rPath)) {
        rendererCode = fs.readFileSync(rPath, 'utf8');
      } else {
        logger.warn(`[${mod.id}] Missing renderer script: ${rPath}`);
      }
    }

    if (mod.css) {
      const cPath = path.join(mod.dir, mod.css);
      if (fs.existsSync(cPath)) {
        cssCode = fs.readFileSync(cPath, 'utf8');
      }
    }

    return {
      id: mod.id,
      name: mod.name,
      version: mod.version,
      author: mod.author,
      description: mod.description,
      rendererCode,
      cssCode,
    };
  });
}

// ---------------------------------------------------------------------------
// APK mods run in their own BrowserWindow with a persistent session partition.
//
// Why: APK engines and the PC game both store mixes in localStorage under
// "mix-<link>". Sharing the file:// origin let the PC game's deleteOldLocalMixes()
// (deletes any mix whose link mixes digits+letters) wipe APK mixes, and the APK
// engine overwrote the PC "user-lang". A separate partition = separate storage.
// ---------------------------------------------------------------------------
const PC_SRC_DIR = path.resolve(__dirname, '../src');
const PC_INDEX_URL = pathToFileURL(path.join(PC_SRC_DIR, 'index.html')).href;
const PC_SRC_BASE_URL = pathToFileURL(PC_SRC_DIR).href.replace(/\/?$/, '/');
const BACKUP_INTERVAL_MS = 30 * 1000;

const apkWindows = new Map(); // apkMod.id -> BrowserWindow
let pcWindow = null;

function publicApkMods() {
  return apkMods.map(({ id, name, versionId, characters, nbpolo, entryUrl }) => ({
    id,
    name,
    versionId,
    characters,
    nbpolo,
    entryUrl,
  }));
}

function findApkModForUrl(url) {
  return (
    apkMods.find((m) => m.versionId && url.includes(`app.html?v=${m.versionId}`)) ||
    apkMods.find((m) => url.startsWith(m.wwwBaseUrl))
  );
}

function partitionFor(apkMod) {
  const safe = apkMod.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const hash = crypto.createHash('sha1').update(apkMod.id).digest('hex').slice(0, 8);
  return `persist:apkmod-${safe}-${hash}`;
}

function apkWebPreferences(parent, apkMod) {
  let prefs = {};
  try {
    if (typeof parent.webContents.getLastWebPreferences === 'function') {
      prefs = parent.webContents.getLastWebPreferences() || {};
    }
  } catch (_) {
    prefs = {};
  }
  const fallbackPreload = path.join(PC_SRC_DIR, 'elec-preload.js');
  const webPreferences = {
    // Same preload as the PC game: APK engines call _electron.machine.machineIdSync() on desktop.
    preload: prefs.preload || (fs.existsSync(fallbackPreload) ? fallbackPreload : undefined),
    contextIsolation: prefs.contextIsolation !== false,
    nodeIntegration: false,
    partition: partitionFor(apkMod),
  };
  if (typeof prefs.sandbox === 'boolean') webPreferences.sandbox = prefs.sandbox;
  if (typeof prefs.webSecurity === 'boolean') webPreferences.webSecurity = prefs.webSecurity;
  if (!webPreferences.preload) delete webPreferences.preload;
  return webPreferences;
}

// Restore files: <ApkMods>/<mod>/restore/*.json = { "key": "...", "value": "..." }
// Written into the mod's localStorage only if the key is missing, then moved to restore/done/.
async function applyPendingRestores(apkMod, wc) {
  const dir = path.join(apkMod.dir, 'restore');
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'))) {
    const filePath = path.join(dir, file);
    try {
      const { key, value } = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (typeof key !== 'string' || typeof value !== 'string') {
        throw new Error('restore file must be {"key": string, "value": string}');
      }
      const result = await wc.executeJavaScript(
        `(() => { const k = ${JSON.stringify(key)};
          if (localStorage.getItem(k) !== null) return 'exists';
          localStorage.setItem(k, ${JSON.stringify(value)}); return 'restored'; })()`
      );
      const doneDir = path.join(dir, 'done');
      fs.mkdirSync(doneDir, { recursive: true });
      fs.renameSync(filePath, path.join(doneDir, file));
      logger.info(`[${apkMod.id}] Restore ${key}: ${result}.`);
    } catch (err) {
      logger.error(`[${apkMod.id}] Restore ${file} failed: ${err.message}`);
    }
  }
}

// Mirrors every mix-/fav- entry to <ApkMods>/<mod>/saves/:
//   backup-latest.json   exact current set (previous version kept as backup-previous.json)
//   backup-archive.json  union of everything ever seen (entries are never removed)
async function backupApkSaves(apkMod, wc) {
  if (!wc || wc.isDestroyed()) return;
  try {
    const json = await wc.executeJavaScript(
      `(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); if (/^(mix|fav)-/.test(k)) o[k] = localStorage.getItem(k); }
        return JSON.stringify(o); })()`
    );
    const items = JSON.parse(json);
    const dir = path.join(apkMod.dir, 'saves');
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();

    const archivePath = path.join(dir, 'backup-archive.json');
    let archive = { mod: apkMod.name, items: {} };
    if (fs.existsSync(archivePath)) archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    let archiveChanged = false;
    for (const [k, v] of Object.entries(items)) {
      if (archive.items[k] !== v) {
        archive.items[k] = v;
        archiveChanged = true;
      }
    }
    if (archiveChanged) {
      archive.updatedAt = now;
      fs.writeFileSync(archivePath, JSON.stringify(archive, null, 1), 'utf8');
    }

    const latestPath = path.join(dir, 'backup-latest.json');
    if (fs.existsSync(latestPath)) {
      const prev = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
      if (JSON.stringify(prev.items) === JSON.stringify(items)) return;
      fs.copyFileSync(latestPath, path.join(dir, 'backup-previous.json'));
    }
    fs.writeFileSync(latestPath, JSON.stringify({ mod: apkMod.name, savedAt: now, items }, null, 1), 'utf8');
    logger.info(`[${apkMod.id}] Saves backed up (${Object.keys(items).length} mix/fav).`);
  } catch (err) {
    logger.warn(`[${apkMod.id}] Save backup failed: ${err.message}`);
  }
}

function showPcWindow() {
  if (apkWindows.size > 0) return;
  if (pcWindow && !pcWindow.isDestroyed()) {
    pcWindow.show();
    pcWindow.focus();
  }
}

function openApkWindow(apkMod, fromWin) {
  const existing = apkWindows.get(apkMod.id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }

  const parent = pcWindow && !pcWindow.isDestroyed() ? pcWindow : fromWin;
  const win = new BrowserWindow({
    ...parent.getBounds(),
    show: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: `Incredibox - ${apkMod.name}`,
    webPreferences: apkWebPreferences(parent, apkMod),
  });
  win.__apkModId = apkMod.id;
  apkWindows.set(apkMod.id, win);
  logger.info(`[${apkMod.id}] Opening APK mod window (partition ${partitionFor(apkMod)}).`);

  let shown = false;
  const reveal = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    if (parent.isFullScreen()) win.setFullScreen(true);
    else if (parent.isMaximized()) win.maximize();
    win.show();
    win.focus();
    if (parent !== win && !parent.isDestroyed()) parent.hide();
  };
  win.once('ready-to-show', reveal);
  setTimeout(reveal, 4000);

  const timer = setInterval(() => backupApkSaves(apkMod, win.webContents), BACKUP_INTERVAL_MS);
  let backedUpOnClose = false;
  win.on('close', (event) => {
    if (backedUpOnClose) return;
    event.preventDefault();
    backedUpOnClose = true;
    backupApkSaves(apkMod, win.webContents).finally(() => {
      if (!win.isDestroyed()) win.destroy();
    });
  });
  win.on('closed', () => {
    clearInterval(timer);
    apkWindows.delete(apkMod.id);
    showPcWindow();
  });

  win.loadURL(apkMod.entryUrl);
  return win;
}

function attachWindowHooks(win) {
  const wc = win.webContents;
  const pcIndexUrl = PC_INDEX_URL;

  // Constructor emits browser-window-created before __apkModId is set, so decide on the next tick.
  setImmediate(() => {
    if (!pcWindow && !win.__apkModId) pcWindow = win;
  });

  wc.on('before-input-event', (event, input) => {
    const isF12 = input.key === 'F12' && input.type === 'keyDown';
    const isCtrlShiftI =
      input.control && input.shift && input.key.toUpperCase() === 'I' && input.type === 'keyDown';
    if (isF12 || isCtrlShiftI) {
      if (wc.isDevToolsOpened()) {
        wc.closeDevTools();
      } else {
        wc.openDevTools({ mode: 'detach' });
      }
      event.preventDefault();
    }
  });

  wc.on('will-navigate', (event, url) => {
    const target = findApkModForUrl(url);
    if (target) {
      if (win.__apkModId === target.id) return; // navigation inside this APK mod's own pages
      event.preventDefault();
      logger.info(`Opening APK mod "${target.name}" for ${url}`);
      openApkWindow(target, win);
      if (win.__apkModId) win.close(); // switching from one APK mod to another
      return;
    }
    if (win.__apkModId && url.startsWith(PC_SRC_BASE_URL)) {
      // "Back to PC Incredibox" from an APK window: close it, the PC window comes back.
      event.preventDefault();
      win.close();
    }
  });

  wc.on('dom-ready', async () => {
    try {
      const currentUrl = wc.getURL();
      const target = findApkModForUrl(currentUrl);
      if (target && win.__apkModId !== target.id) {
        // Navigation that bypassed will-navigate (e.g. main-process loadURL).
        logger.info(`Opening APK mod "${target.name}" (dom-ready) for ${currentUrl}`);
        openApkWindow(target, win);
        if (win.__apkModId) win.close();
        else wc.loadURL(PC_INDEX_URL);
        return;
      }
      const apkMod = win.__apkModId ? apkMods.find((m) => m.id === win.__apkModId) : null;
      if (apkMod) {
        await applyPendingRestores(apkMod, wc);
        await backupApkSaves(apkMod, wc);
      }
      const isApkMode = Boolean(apkMod);
      const rendererBootstrapPath = path.join(__dirname, 'renderer.js');
      const bootstrapCode = fs.readFileSync(rendererBootstrapPath, 'utf8');
      const modsPayload = buildRendererPayload();

      await wc.executeJavaScript(
        `(() => {
          window.__INCREDIBOX_MODLOADER_INIT__ = ${JSON.stringify({
            version: LOADER_VERSION,
            mods: modsPayload,
            apkMods: publicApkMods(),
            isApkMode,
            pcIndexUrl,
          })};
          ${bootstrapCode}
        })();`
      );
      logger.info(`Injected ModLoader into renderer (${currentUrl}).`);
    } catch (err) {
      logger.error(`Renderer injection failed: ${err.stack || err.message}`);
    }
  });
}

app.on('browser-window-created', (_event, win) => {
  logger.info('BrowserWindow created, attaching ModLoader hooks.');
  attachWindowHooks(win);
});

// Ensure Incredibox's Steam library check (PORTABLE_EXECUTABLE_DIR + --arg=arp) passes when launched directly
if (!process.env.PORTABLE_EXECUTABLE_DIR) {
  process.env.PORTABLE_EXECUTABLE_DIR = path.dirname(getGameRoot());
}
if (!app.commandLine.hasSwitch('arg')) {
  app.commandLine.appendSwitch('arg', 'arp');
}

// ---------------------------------------------------------------------------
// PC Engine Patch: unlock >20 icons and configurable nbpolo in script.min.js
//
// PC v1.2.9 script.min.js already uses dynamic variables lQ (icon count) and
// pQ (polo count) in every game loop, with only 5 hardcoded constants/hooks.
// Patching once (with a .orig backup and version marker) lets any PC
// incredimod with >20 characters or nbpolo != 7 run natively in the PC window.
// ---------------------------------------------------------------------------
const PC_ENGINE_PATCH_MARKER = '/*INCREDIBOX_MODLOADER_100P_V3*/';

function ensurePcEnginePatched() {
  const scriptPath = path.join(PC_SRC_DIR, 'js', 'script.min.js');
  if (!fs.existsSync(scriptPath)) return;

  try {
    const current = fs.readFileSync(scriptPath, 'utf8');
    if (current.includes(PC_ENGINE_PATCH_MARKER)) return;

    const origPath = scriptPath + '.orig';
    let raw;
    if (fs.existsSync(origPath)) {
      raw = fs.readFileSync(origPath, 'utf8');
    } else {
      raw = current;
      fs.writeFileSync(origPath, raw, 'utf8');
    }

    const patches = [
      {
        name: 'unlock-icon-cap',
        re: /lQ=\(lQ=px\['\\x61\\x6e\\x69\\x6d\\x65\\x61\\x72\\x72\\x61\\x79'\]\[([^\]]+)\]\)\>0x14\?0x14:lQ/g,
        rep: "lQ=(lQ=px['\\x61\\x6e\\x69\\x6d\\x65\\x61\\x72\\x72\\x61\\x79'][$1])",
      },
      {
        name: 'dynamic-nbpolo-and-recmaxloop',
        re: /\bpQ=0x7\b/g,
        rep: 'pQ=(px&&(px.recmaxloop=Math.max(999,Math.ceil(9999000/(px.looptime||8000))),px.recminloop=px.recminloop||2,px.recmintime=px.recmintime||Math.round((px.looptime||8000)/1000)*px.recminloop),px&&px.nbpolo>0?px.nbpolo:0x7)',
      },
      {
        name: 'polo-width-6.8',
        re: /\baq=6\.8\b/g,
        rep: 'aq=(pQ>7?pQ-0.2:6.8),ak*=(aq/6.8)',
      },
      {
        name: 'polo-width-6.3',
        re: /\baq=6\.3\b/g,
        rep: 'aq=(pQ>7?pQ-0.5:6.3),ak*=(aq/6.3)',
      },
      {
        name: 'resize-picto-hook',
        re: /\bpoloBlocGapX=av\/0x2,/g,
        rep: '(window.__mlLayoutPcPictos&&window.__mlLayoutPcPictos(lQ,pQ)),poloBlocGapX=av/0x2,',
      },
    ];

    let patched = raw;
    for (const p of patches) {
      const matches = patched.match(p.re);
      if (!matches || matches.length !== 1) {
        logger.warn(
          `[EnginePatch] Skipping script.min.js patch: "${p.name}" matched ${matches ? matches.length : 0} time(s) (expected 1).`
        );
        return;
      }
      patched = patched.replace(p.re, p.rep);
    }

    const tmpPath = scriptPath + '.tmp';
    fs.writeFileSync(tmpPath, PC_ENGINE_PATCH_MARKER + '\n' + patched, 'utf8');
    fs.renameSync(tmpPath, scriptPath);
    logger.info('[EnginePatch] Patched script.min.js for >20 icons and configurable nbpolo.');
  } catch (err) {
    logger.error(`[EnginePatch] Failed to patch script.min.js: ${err.message}`);
  }
}

ensurePcEnginePatched();

// Hand off execution to the original Incredibox main script
require('../src/elec-index.js');
