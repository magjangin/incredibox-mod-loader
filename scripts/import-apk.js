'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  stableVersionId,
  parseAppJs,
  findBandizip,
  toDataURL,
  normalizeColor,
  isGameRunning,
  installIncredimod,
} = require('./lib/common');

function getPngWidth(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return buf.readUInt32BE(16);
  }
  return 0;
}

function convertAssetFolder(assetDir) {
  const appJsPath = path.join(assetDir, 'app.js');
  if (!fs.existsSync(appJsPath)) {
    throw new Error(`app.js not found in ${assetDir}`);
  }

  const rawApp = parseAppJs(appJsPath);
  const modName = rawApp.name || path.basename(assetDir);
  const versionId = stableVersionId(modName);

  const colors = [
    normalizeColor(rawApp.colBck, '#1a1a1a'),
    normalizeColor(rawApp.col0, '#333333'),
    normalizeColor(rawApp.col1, '#444444'),
    normalizeColor(rawApp.col2, '#555555'),
    normalizeColor(rawApp.col3, '#666666'),
    normalizeColor(rawApp.col4, '#777777'),
  ];

  const animearray = (rawApp.animearray || []).map((item) => ({
    name: item.name,
    color: normalizeColor(item.color, '#777777'),
    uniqsnd: Boolean(item.uniqsnd),
  }));

  const bonusarray = Array.isArray(rawApp.bonusarray) ? rawApp.bonusarray : [];
  const modDate = rawApp.date && /^\d{4}-\d{2}-\d{2}$/.test(rawApp.date)
    ? rawApp.date
    : `${rawApp.date || '2023'}-01-01`;

  const pack = {};

  // Detect LD vs HD from polo-sprite.png width (LD=656, HD=1312)
  const poloPath = path.join(assetDir, 'img', 'polo-sprite.png');
  let isHd = false;
  if (fs.existsSync(poloPath)) {
    const poloBuf = fs.readFileSync(poloPath);
    isHd = getPngWidth(poloBuf) >= 1000;
    const poloKey = isHd ? 'anime/0_polo.png' : 'anime/0_polo-ld.png';
    pack[poloKey] = { dataURL: toDataURL(poloBuf) };
  }
  const spriteSuffix = isHd ? '.png' : '-ld.png';

  // 1. Anime sprites & JSONs
  const animeDir = path.join(assetDir, 'anime');
  if (fs.existsSync(animeDir)) {
    for (const file of fs.readdirSync(animeDir)) {
      const full = path.join(animeDir, file);
      if (!fs.statSync(full).isFile()) continue;
      if (file.endsWith('-sprite.png')) {
        const cleanName = file.slice(0, -'-sprite.png'.length) + spriteSuffix;
        pack[`anime/${cleanName}`] = { dataURL: toDataURL(fs.readFileSync(full)) };
      } else if (file.endsWith('.json')) {
        pack[`anime/${file}`] = { dataURL: toDataURL(fs.readFileSync(full)) };
      } else if (file.endsWith('.png')) {
        const target = isHd || file.endsWith('-ld.png') ? file : file.replace(/\.png$/, '-ld.png');
        pack[`anime/${target}`] = { dataURL: toDataURL(fs.readFileSync(full)) };
      }
    }
  }

  const gameBckPath = path.join(assetDir, 'img', 'game-bck.jpg');
  if (fs.existsSync(gameBckPath)) {
    pack['image/game-bck.jpg'] = { dataURL: toDataURL(fs.readFileSync(gameBckPath)) };
  }

  const gamePictoPath = path.join(assetDir, 'img', 'game-picto.png');
  if (fs.existsSync(gamePictoPath)) {
    pack['image/game-picto.png'] = { dataURL: toDataURL(fs.readFileSync(gamePictoPath)) };
  }

  const splashCandidates = [
    path.join(assetDir, 'splash', 'homescreen.jpg'),
    path.join(assetDir, 'splash', 'big-homescreen.jpg'),
    path.join(assetDir, 'img', 'home-screen.jpg'),
  ];
  const splashPath = splashCandidates.find((p) => fs.existsSync(p));
  let iconDataURL = '';
  if (splashPath) {
    const splashDataURL = toDataURL(fs.readFileSync(splashPath));
    iconDataURL = splashDataURL;
    pack['image/home-screen.jpg'] = { dataURL: splashDataURL };
    pack['image/icon.jpg'] = { dataURL: splashDataURL };
    pack['image/crew.jpg'] = { dataURL: splashDataURL };
  }

  // 3. Sounds (ogg / mp3)
  let audioFormat = 'ogg';
  for (const fmt of ['ogg', 'mp3']) {
    const soundDir = path.join(assetDir, 'sound', fmt);
    if (!fs.existsSync(soundDir)) continue;
    const files = fs.readdirSync(soundDir);
    if (files.length > 0) {
      audioFormat = fmt;
      for (const file of files) {
        const full = path.join(soundDir, file);
        if (!fs.statSync(full).isFile()) continue;
        pack[`sound/${fmt}/${file}`] = { dataURL: toDataURL(fs.readFileSync(full)) };
      }
    }
  }

  const formats = [isHd ? 'hd' : 'ld', audioFormat];

  const appJson = {
    name: modName,
    date: modDate,
    looptime: Number(rawApp.looptime || 8000),
    bpm: Number(rawApp.bpm || 120),
    totalframe: Number(rawApp.totalframe || 384),
    bonusloopA: Boolean(rawApp.bonusloopA),
    bonusendloopA: Boolean(rawApp.bonusendloopA),
    colors,
    animearray,
    bonusarray,
    credit: {
      crewname: 'APK Import',
      process: ['Converted from Android APK'],
      thanks: 'Imported via Incredibox APK Loader',
    },
    format: formats,
    modders: ['APK Import'],
  };
  // 100-character APKs (e.g. 10 polos) run natively in the PC window with the
  // ModLoader engine patch (modloader/engine-patch.js) when nbpolo is kept.
  if (Number(rawApp.nbpolo) > 0) appJson.nbpolo = Number(rawApp.nbpolo);

  const appJsonBuf = Buffer.from(JSON.stringify(appJson), 'utf8');
  pack['app.json'] = { dataURL: toDataURL(appJsonBuf) };

  const packJsonStr = JSON.stringify(pack);
  appJson.size = Buffer.byteLength(packJsonStr, 'utf8');

  const { dest: modFilePath } = installIncredimod({
    packStr: packJsonStr,
    entry: {
      version: versionId,
      name: modName,
      crew: 'APK Import',
      modders: ['APK Import'],
      date: modDate,
      icon: iconDataURL,
      format: formats,
      size: appJson.size,
      modio: false,
    },
  });

  return {
    versionId,
    modName,
    characters: animearray.length,
    files: Object.keys(pack).length,
    sizeMB: (appJson.size / (1024 * 1024)).toFixed(2),
    modFilePath,
  };
}

function main() {
  const args = process.argv.slice(2);
  const defaultApk = path.join(process.env.USERPROFILE, 'Downloads', 'Incredibox.apk');
  const apkPath = path.resolve(args.find((a) => !a.startsWith('--')) || defaultApk);

  if (isGameRunning() && !args.includes('--force')) {
    console.error('Incredibox is running. Close the game first (it rewrites localmods.json), or pass --force.');
    process.exit(2);
  }

  if (!fs.existsSync(apkPath)) {
    console.error(`APK not found: ${apkPath}`);
    process.exit(1);
  }
  let BANDIZIP;
  try {
    BANDIZIP = findBandizip();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const tempExtract = path.join(process.env.TEMP, 'incredibox_apk_import');
  fs.rmSync(tempExtract, { recursive: true, force: true });
  fs.mkdirSync(tempExtract, { recursive: true });

  console.log(`Extracting assets/www from ${apkPath}...`);
  execFileSync(BANDIZIP, ['x', '-y', '-r', `-o:${tempExtract}`, apkPath, 'assets\\www\\asset-v*'], {
    stdio: 'inherit',
  });

  const wwwDir = path.join(tempExtract, 'assets', 'www');
  if (!fs.existsSync(wwwDir)) {
    console.error('assets/www not found in APK.');
    process.exit(1);
  }

  const assetDirs = fs
    .readdirSync(wwwDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^asset-v\d+$/i.test(d.name))
    .map((d) => path.join(wwwDir, d.name));

  if (assetDirs.length === 0) {
    console.error('No asset-v* folders found inside assets/www.');
    process.exit(1);
  }

  for (const dir of assetDirs) {
    const res = convertAssetFolder(dir);
    console.log(
      `Imported "${res.modName}" (version=${res.versionId}, ${res.characters} characters, ${res.files} files, ${res.sizeMB} MB) -> ${res.modFilePath}`
    );
  }

  fs.rmSync(tempExtract, { recursive: true, force: true });
}

if (require.main === module) {
  main();
}

module.exports = { convertAssetFolder };
