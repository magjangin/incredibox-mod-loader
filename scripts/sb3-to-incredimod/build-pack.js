// Pack out/phase<N>/ into an Incredibox PC incredimod (<versionId>.json) and register it in localmods.json.
// usage: node build-pack.js --work <dir> [--config <file>] [--phase 1] [--install [--force]]
const fs = require('fs');
const path = require('path');
const { stableVersionId, findModdedDir } = require('../lib/common');
const { getOptions, gameRunning } = require('./lib');

const opts = getOptions();
const { config, phase, install } = opts;
const P = config.phases[phase];
const DIR = path.join(opts.out, `phase${phase}`);
const MODS_DIR = path.join(process.env.APPDATA, 'Incredibox', 'incredimods');
const KEEP_BACKUPS = 5;

// Keep only the newest KEEP_BACKUPS localmods.json.bak-<time> files.
function pruneBackups() {
  const baks = fs
    .readdirSync(MODS_DIR)
    .filter((f) => /^localmods\.json\.bak-\d+$/.test(f))
    .sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
  for (const f of baks.slice(KEEP_BACKUPS)) fs.rmSync(path.join(MODS_DIR, f));
  return Math.max(0, baks.length - KEEP_BACKUPS);
}

if (install && gameRunning() && !process.argv.includes('--force')) {
  console.error('Incredibox is running. Close the game before --install (it would overwrite localmods.json), or pass --force.');
  process.exit(2);
}

// Directory with the game's own polo-sprite.png (fallback empty-slot beatboxer).
function gameImgDir() {
  const modded = process.env.INCREDIBOX_MODDED_DIR || findModdedDir();
  const dir = modded && path.join(modded, 'resources', 'app', 'src', 'img');
  if (!dir || !fs.existsSync(path.join(dir, 'polo-sprite.png'))) {
    throw new Error('Game polo-sprite.png not found. Run setup-game.ps1 or set INCREDIBOX_MODDED_DIR.');
  }
  return dir;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', json: 'application/json', ogg: 'audio/ogg' };
const dataUrl = (buf, ext) => `data:${MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}`;

const art = JSON.parse(fs.readFileSync(path.join(DIR, 'art.json'), 'utf8'));
const name = config.modName + P.label;
const versionId = stableVersionId(name);
const pack = {};

function addFile(key, file) {
  pack[key] = { dataURL: dataUrl(fs.readFileSync(file), path.extname(file).slice(1).toLowerCase()) };
}

for (const sub of ['anime', 'image', path.join('sound', 'ogg')]) {
  for (const f of fs.readdirSync(path.join(DIR, sub))) addFile(`${sub.replace(/\\/g, '/')}/${f}`, path.join(DIR, sub, f));
}
// Empty-slot polo: generated panel if build-art made one, else the game's default (local install only).
if (!pack['anime/0_polo.png']) {
  const img = gameImgDir();
  addFile('anime/0_polo.png', path.join(img, 'polo-sprite.png'));
  addFile('anime/0_polo-ld.png', path.join(img, 'polo-sprite-ld.png'));
}

const appJson = {
  name,
  date: '2025-06-12',
  looptime: Math.round(P.loopSec * 1000),
  bpm: P.bpm,
  totalframe: P.framesPerLoop * 2,
  bonusloopA: false,
  bonusendloopA: false,
  colors: phase === '2'
    ? ['#0b2a2a', '#1d4d4a', '#173f3d', '#11302f', '#0b2221', '#061413']
    : ['#3eb3f0', '#2a9ad8', '#1f7fb6', '#176591', '#104b6c', '#0a3148'],
  animearray: art.animearray.map((a) => ({ name: a.name, color: a.color, uniqsnd: false })),
  bonusarray: [],
  credit: {
    crewname: config.author,
    process: [
      `Original Scratch project by ${config.author} (${config.platform || 'Cocrea'})`,
      'Converted with Incredibox ModLoader sb3 converter',
    ],
    thanks: config.source,
  },
  format: ['ld', 'hd', 'ogg'],
  modders: [config.author],
};
pack['app.json'] = { dataURL: dataUrl(Buffer.from(JSON.stringify(appJson), 'utf8'), 'json') };
const packStr = JSON.stringify(pack);
const size = Buffer.byteLength(packStr, 'utf8');

const outFile = path.join(opts.out, `${versionId}.json`);
fs.writeFileSync(outFile, packStr, 'utf8');
console.log(`pack "${name}" v=${versionId}: ${Object.keys(pack).length} files, ${(size / 1048576).toFixed(1)} MB -> ${outFile}`);

if (install) {
  fs.mkdirSync(MODS_DIR, { recursive: true });
  const localPath = path.join(MODS_DIR, 'localmods.json');
  let local = [];
  if (fs.existsSync(localPath)) {
    fs.copyFileSync(localPath, `${localPath}.bak-${Date.now()}`);
    local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
  }
  const entry = {
    version: versionId,
    name,
    crew: config.author,
    modders: appJson.modders,
    date: appJson.date,
    icon: pack['image/icon.jpg'].dataURL,
    format: appJson.format,
    size,
    modio: false,
  };
  const idx = local.findIndex((m) => m.version === versionId);
  if (idx >= 0) local[idx] = entry;
  else local.push(entry);
  fs.copyFileSync(outFile, path.join(MODS_DIR, `${versionId}.json`));
  fs.writeFileSync(localPath, JSON.stringify(local), 'utf8');
  const pruned = pruneBackups();
  console.log(
    `installed -> ${path.join(MODS_DIR, `${versionId}.json`)} (localmods: ${local.length} entries${pruned ? `, ${pruned} old backups removed` : ''})`
  );
}
