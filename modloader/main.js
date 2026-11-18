'use strict';

const fs = require('fs');
const path = require('path');
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

function attachWindowHooks(win) {
  const wc = win.webContents;
  const pcIndexUrl = pathToFileURL(path.resolve(__dirname, '../src/index.html')).href;

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
    for (const apkMod of apkMods) {
      if (apkMod.versionId && url.includes(`app.html?v=${apkMod.versionId}`)) {
        logger.info(`Redirecting v=${apkMod.versionId} to APK mod "${apkMod.name}": ${apkMod.entryUrl}`);
        event.preventDefault();
        wc.loadURL(apkMod.entryUrl);
        return;
      }
    }
  });

  wc.on('dom-ready', async () => {
    try {
      const currentUrl = wc.getURL();
      for (const apkMod of apkMods) {
        if (apkMod.versionId && currentUrl.includes(`app.html?v=${apkMod.versionId}`)) {
          logger.info(`Redirecting (dom-ready) v=${apkMod.versionId} to APK mod "${apkMod.name}": ${apkMod.entryUrl}`);
          wc.loadURL(apkMod.entryUrl);
          return;
        }
      }
      const isApkMode = currentUrl.includes('/ApkMods/');
      const rendererBootstrapPath = path.join(__dirname, 'renderer.js');
      const bootstrapCode = fs.readFileSync(rendererBootstrapPath, 'utf8');
      const modsPayload = buildRendererPayload();

      await wc.executeJavaScript(
        `(() => {
          window.__INCREDIBOX_MODLOADER_INIT__ = ${JSON.stringify({
            version: LOADER_VERSION,
            mods: modsPayload,
            apkMods,
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

// Hand off execution to the original Incredibox main script
require('../src/elec-index.js');
