'use strict';

/**
 * Multi-Mod 100-Character / 10-Polo Incredimod Builder
 *
 * Combines multiple 20-character sources (PC incredimod JSONs, Android APKs,
 * Electron ASAR ZIPs, or unpacked asset-v* directories) into a single PC
 * incredimod pack with unified master BPM/looptime, pitch-preserving ffmpeg
 * audio time-stretching, resampled animation timelines, and a stitched
 * game-picto.png strip.
 *
 * Usage:
 *   node scripts/build-100p-mod.js <config.json> [--install] [--force]
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { stableVersionId, parseAppJs } = require('./lib/common');

const AUDIO_CONCURRENCY = 8;

function toDataURL(buf, mime = 'application/octet-stream') {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function fromDataURL(url) {
  const idx = url.indexOf(',');
  if (idx === -1) throw new Error('Invalid dataURL');
  return Buffer.from(url.slice(idx + 1), 'base64');
}

function normalizeColor(c, fallback = '#777777') {
  if (!c || typeof c !== 'string') return fallback;
  const trimmed = c.trim();
  return trimmed.startsWith('#') ? trimmed : '#' + trimmed;
}

function isIncrediboxRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Incredibox*', '/NH'], {
      encoding: 'utf8',
    });
    return /Incredibox/i.test(out);
  } catch (_) {
    return false;
  }
}

function extractAsarDir(asarPath, relDir, outDir) {
  const buf = fs.readFileSync(asarPath);
  const headerSize = buf.readUInt32LE(4);
  const jsonSize = buf.readUInt32LE(12);
  const dataStart = 8 + headerSize;
  const header = JSON.parse(buf.subarray(16, 16 + jsonSize).toString('utf8'));

  let node = header;
  for (const part of relDir.split('/').filter(Boolean)) {
    if (!node.files || !node.files[part]) {
      throw new Error(`ASAR path not found: ${relDir}`);
    }
    node = node.files[part];
  }

  function walk(cur, dst) {
    if (cur.files) {
      fs.mkdirSync(dst, { recursive: true });
      for (const [k, v] of Object.entries(cur.files)) {
        walk(v, path.join(dst, k));
      }
    } else if (cur.offset !== undefined) {
      const start = dataStart + Number(cur.offset);
      fs.writeFileSync(dst, buf.subarray(start, start + cur.size));
    }
  }
  walk(node, outDir);
}

/**
 * Load a normalized source object:
 * {
 *   label, name, looptime, bpm, totalframe,
 *   characters: [{ name, color, uniqsnd, json, spriteHd, spriteLd, soundA, soundB }],
 *   pictoBuf, bckBuf, coverBuf, poloHdBuf
 * }
 */
function loadSource(srcCfg, workDir) {
  if (srcCfg.type === 'incredimod') {
    const jsonPath = srcCfg.path;
    const pack = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const appJson = JSON.parse(fromDataURL(pack['app.json'].dataURL).toString('utf8'));
    const characters = appJson.animearray.map((a) => {
      const n = a.name;
      const jBuf = fromDataURL(pack[`anime/${n}.json`].dataURL);
      const j = JSON.parse(jBuf.toString('utf8'));
      const spriteHd = pack[`anime/${n}.png`] ? fromDataURL(pack[`anime/${n}.png`].dataURL) : null;
      const spriteLd = pack[`anime/${n}-ld.png`] ? fromDataURL(pack[`anime/${n}-ld.png`].dataURL) : null;
      const soundA = pack[`sound/ogg/${n}_a.ogg`]
        ? { ext: 'ogg', buf: fromDataURL(pack[`sound/ogg/${n}_a.ogg`].dataURL) }
        : pack[`sound/mp3/${n}_a.mp3`]
          ? { ext: 'mp3', buf: fromDataURL(pack[`sound/mp3/${n}_a.mp3`].dataURL) }
          : null;
      const soundB = !a.uniqsnd
        ? pack[`sound/ogg/${n}_b.ogg`]
          ? { ext: 'ogg', buf: fromDataURL(pack[`sound/ogg/${n}_b.ogg`].dataURL) }
          : pack[`sound/mp3/${n}_b.mp3`]
            ? { ext: 'mp3', buf: fromDataURL(pack[`sound/mp3/${n}_b.mp3`].dataURL) }
            : null
        : null;
      return {
        name: n,
        color: normalizeColor(a.color),
        uniqsnd: Boolean(a.uniqsnd),
        json: j,
        spriteHd: spriteHd || spriteLd,
        spriteLd: spriteLd || spriteHd,
        soundA,
        soundB,
      };
    });
    return {
      label: srcCfg.label || appJson.name,
      name: appJson.name,
      looptime: Number(appJson.looptime),
      bpm: Number(appJson.bpm),
      totalframe: Number(appJson.totalframe),
      doubleLoop: Boolean(srcCfg.doubleLoop),
      characters,
      pictoBuf: pack['image/game-picto.png'] ? fromDataURL(pack['image/game-picto.png'].dataURL) : null,
      bckBuf: pack['image/game-bck.jpg'] ? fromDataURL(pack['image/game-bck.jpg'].dataURL) : null,
      coverBuf: pack['image/home-screen.jpg']
        ? fromDataURL(pack['image/home-screen.jpg'].dataURL)
        : pack['image/icon.jpg']
          ? fromDataURL(pack['image/icon.jpg'].dataURL)
          : null,
      poloHdBuf: pack['anime/0_polo.png'] ? fromDataURL(pack['anime/0_polo.png'].dataURL) : null,
      poloLdBuf: pack['anime/0_polo-ld.png'] ? fromDataURL(pack['anime/0_polo-ld.png'].dataURL) : null,
    };
  }

  let assetDir = srcCfg.dir;
  if (srcCfg.type === 'apk') {
    const sub = srcCfg.assetDir || 'assets/www/asset-v1';
    const extractBase = path.join(workDir, 'extracted', srcCfg.id);
    assetDir = path.join(extractBase, sub);
    if (!fs.existsSync(path.join(assetDir, 'app.js'))) {
      fs.mkdirSync(extractBase, { recursive: true });
      execFileSync('tar', ['-xf', srcCfg.path, '-C', extractBase, sub]);
    }
  } else if (srcCfg.type === 'asar-zip') {
    const extractBase = path.join(workDir, 'extracted', srcCfg.id);
    assetDir = path.join(extractBase, 'asset');
    if (!fs.existsSync(path.join(assetDir, 'app.js'))) {
      fs.mkdirSync(extractBase, { recursive: true });
      execFileSync('tar', ['-xf', srcCfg.path, '-C', extractBase, srcCfg.asarEntry]);
      const asarAbs = path.join(extractBase, srcCfg.asarEntry);
      extractAsarDir(asarAbs, srcCfg.asarDir, assetDir);
      fs.rmSync(asarAbs, { force: true });
    }
  }

  const rawApp = parseAppJs(path.join(assetDir, 'app.js'));
  const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);

  const characters = rawApp.animearray.map((a) => {
    const n = a.name;
    const j = JSON.parse(fs.readFileSync(path.join(assetDir, 'anime', `${n}.json`), 'utf8'));
    const spriteHd =
      readIf(path.join(assetDir, 'anime', `${n}-sprite-hd.png`)) ||
      readIf(path.join(assetDir, 'anime', `${n}.png`)) ||
      readIf(path.join(assetDir, 'anime', `${n}-sprite.png`));
    const spriteLd =
      readIf(path.join(assetDir, 'anime', `${n}-sprite.png`)) ||
      readIf(path.join(assetDir, 'anime', `${n}-ld.png`)) ||
      spriteHd;

    const findSnd = (suffix) => {
      for (const fmt of ['ogg', 'mp3', 'wav']) {
        const p = path.join(assetDir, 'sound', fmt, `${n}_${suffix}.${fmt}`);
        if (fs.existsSync(p)) return { ext: fmt, buf: fs.readFileSync(p) };
      }
      return null;
    };

    return {
      name: n,
      color: normalizeColor(a.color),
      uniqsnd: Boolean(a.uniqsnd),
      json: j,
      spriteHd,
      spriteLd,
      soundA: findSnd('a'),
      soundB: a.uniqsnd ? null : findSnd('b'),
    };
  });

  const pictoBuf =
    readIf(path.join(assetDir, 'img', 'game-picto-hd.png')) ||
    readIf(path.join(assetDir, 'img', 'game-picto.png'));
  const bckBuf =
    readIf(path.join(assetDir, 'img', 'game-bck-hd.jpg')) ||
    readIf(path.join(assetDir, 'img', 'game-bck.jpg'));
  const coverBuf =
    readIf(path.join(assetDir, 'splash', 'big-homescreen-hd.jpg')) ||
    readIf(path.join(assetDir, 'splash', 'big-homescreen.jpg')) ||
    readIf(path.join(assetDir, 'splash', 'homescreen-hd.jpg')) ||
    readIf(path.join(assetDir, 'splash', 'homescreen.jpg')) ||
    bckBuf;
  const poloHdBuf =
    readIf(path.join(assetDir, 'img', 'polo-sprite-hd.png')) ||
    readIf(path.join(assetDir, 'img', 'polo-sprite.png'));
  const poloLdBuf =
    readIf(path.join(assetDir, 'img', 'polo-sprite.png')) ||
    poloHdBuf;

  return {
    label: srcCfg.label || rawApp.name,
    name: rawApp.name,
    looptime: Number(rawApp.looptime),
    bpm: Number(rawApp.bpm),
    totalframe: Number(rawApp.totalframe),
    doubleLoop: Boolean(srcCfg.doubleLoop),
    characters,
    pictoBuf,
    bckBuf,
    coverBuf,
    poloHdBuf,
    poloLdBuf,
  };
}

function buildAtempoFilter(ratio) {
  // ffmpeg atempo accepts [0.5, 2.0]; chain if outside range.
  const parts = [];
  let r = ratio;
  while (r > 2.0) {
    parts.push('atempo=2.0');
    r /= 2.0;
  }
  while (r < 0.5) {
    parts.push('atempo=0.5');
    r /= 0.5;
  }
  parts.push(`atempo=${r.toFixed(6)}`);
  return parts.join(',');
}

function runFfmpegStretch({ inputs, ratio, targetSec, outPath }) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    for (const inp of inputs) {
      args.push('-i', inp);
    }
    const atempo = buildAtempoFilter(ratio);
    const padFilter = `apad,atrim=0:${targetSec.toFixed(6)}`;
    let filterComplex;
    if (inputs.length === 1) {
      filterComplex = `[0:a]${atempo},${padFilter}[out]`;
    } else {
      const concatIn = inputs.map((_, i) => `[${i}:a]`).join('');
      filterComplex = `${concatIn}concat=n=${inputs.length}:v=0:a=1,${atempo},${padFilter}[out]`;
    }
    args.push(
      '-filter_complex',
      filterComplex,
      '-map',
      '[out]',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-c:a',
      'libvorbis',
      '-q:a',
      '4',
      outPath
    );

    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`ffmpeg failed (${code}) for ${outPath}: ${stderr}`));
    });
    proc.on('error', reject);
  });
}

async function runPool(items, concurrency, fn) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
}

function resampleFrames(srcSeq, targetLen) {
  const out = new Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const idx = Math.min(srcSeq.length - 1, Math.floor((i * srcSeq.length) / targetLen));
    out[i] = srcSeq[idx];
  }
  return out;
}

function getPngHeight(buf) {
  if (buf && buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return buf.readUInt32BE(20);
  }
  return 0;
}

function normalizeAndResampleAnimeJson(
  rawJson,
  { srcTotalFrame, srcUniqSnd, doubleLoop, masterTotalFrame, spriteHeightLd }
) {
  const j = JSON.parse(JSON.stringify(rawJson));
  const origFrames = Array.isArray(j.arrayFrame) ? j.arrayFrame : [];
  if (origFrames.length === 0) {
    throw new Error('Empty arrayFrame in anime JSON');
  }

  // Fix legacy 2x width/height bug (e.g. Axiom JSONs with width=328, height=760 on LD 164x380 grid)
  const minPropY = Math.min(
    ...origFrames.map((f) => parseInt(String(f.prop || '0,380').split(',')[1], 10) || 0)
  );
  if (Number(j.width) === 328 && Number(j.height) === 760 && !j.version && minPropY === 380) {
    j.width = '164';
    j.height = '380';
  }

  // Fix floating full-body characters whose JSON sets headHeight=360 on 380px+ tall frames
  // (e.g. Arbox Armed 4_spikes, 8_tourette, 10_nimbus, 19_explorer -> leaves a 20px gap at floor).
  const hh = Number(j.headHeight);
  if (hh >= 350 && hh < 380 && spriteHeightLd > 0) {
    const parsed = origFrames.map((f) => String(f.prop || '0,380,0,0').split(',').map(Number));
    const maxY = Math.max(...parsed.map((p) => p[1] || 0));
    const minDy = Math.min(...parsed.map((p) => p[3] || 0));
    if (minDy >= -50 && maxY + 380 <= spriteHeightLd) {
      j.headHeight = '380';
    }
  }

  // Reconstruct the exact frames the original Incredibox engine plays for this character.
  // In Incredibox, loop A plays indices 0..half-1 (clamped to origFrames.length-1),
  // and loop B plays indices half..full-1 ONLY when origFrames.length === full (otherwise repeats loop A).
  const srcFull = Math.max(2, Math.round(srcTotalFrame || origFrames.length));
  const srcHalf = Math.max(1, Math.round(srcFull / 2));
  const masterHalf = Math.round(masterTotalFrame / 2);

  const sliceClamped = (start, len) => {
    const seq = new Array(len);
    for (let i = 0; i < len; i++) {
      seq[i] = origFrames[Math.min(origFrames.length - 1, start + i)];
    }
    return seq;
  };

  const hasDistinctLoopB = !srcUniqSnd && origFrames.length >= srcFull - 2;
  let resampled;

  if (doubleLoop) {
    // 2 source loops packed into 1 master loop (final uniqsnd = true, length = masterHalf)
    const twoLoops = hasDistinctLoopB
      ? sliceClamped(0, srcFull)
      : sliceClamped(0, srcHalf).concat(sliceClamped(0, srcHalf));
    resampled = resampleFrames(twoLoops, masterHalf);
  } else if (srcUniqSnd) {
    // 1 source loop -> 1 master loop (length = masterHalf)
    resampled = resampleFrames(sliceClamped(0, srcHalf), masterHalf);
  } else if (hasDistinctLoopB) {
    // 2 distinct source loops -> 2 master loops (length = masterTotalFrame)
    resampled = resampleFrames(sliceClamped(0, srcFull), masterTotalFrame);
  } else {
    // uniqsnd=false audio, but 1-loop animation (e.g. Beatboys 12_Cello): repeat 1-loop anim for A & B
    const oneLoop = resampleFrames(sliceClamped(0, srcHalf), masterHalf);
    resampled = oneLoop.concat(oneLoop);
  }

  j.arrayFrame = resampled;
  j.totalFrame = String(resampled.length);
  return j;
}

function stitchImagesWithPython({ pictoPaths, coverPaths, outPicto, outCover, outIcon, iconSize, title }) {
  const pyCode = `
import sys, json
from PIL import Image, ImageDraw, ImageFont, ImageOps

cfg = json.loads(sys.argv[1])
icon_sz = cfg["iconSize"]
picto_paths = cfg["pictoPaths"]

# Stitch N x 20-icon picto strips (each strip is W x H where W = 20*cellW, H = 2*cellH)
tiles_top = []
tiles_bot = []
for p in picto_paths:
    im = Image.open(p).convert("RGBA")
    w, h = im.size
    cell_w = w / 20.0
    cell_h = h / 2.0
    for i in range(20):
        x0 = round(i * cell_w)
        x1 = round((i + 1) * cell_w)
        top_tile = im.crop((x0, 0, x1, round(cell_h))).resize((icon_sz, icon_sz), Image.LANCZOS)
        bot_tile = im.crop((x0, round(cell_h), x1, h)).resize((icon_sz, icon_sz), Image.LANCZOS)
        tiles_top.append(top_tile)
        tiles_bot.append(bot_tile)

total = len(tiles_top)
out_im = Image.new("RGBA", (total * icon_sz, icon_sz * 2), (0, 0, 0, 0))
for i in range(total):
    out_im.paste(tiles_top[i], (i * icon_sz, 0))
    out_im.paste(tiles_bot[i], (i * icon_sz, icon_sz))
out_im.save(cfg["outPicto"], "PNG", optimize=True)

# Build 5-panel home-screen.jpg (2048x980) and square icon.jpg (512x512)
covers = [Image.open(p).convert("RGB") for p in cfg["coverPaths"] if p]
W, H = 2048, 980
banner = Image.new("RGB", (W, H), (16, 16, 22))
if covers:
    n = len(covers)
    panel_w = W // n
    for idx, c in enumerate(covers):
        pw = panel_w if idx < n - 1 else (W - panel_w * (n - 1))
        fitted = ImageOps.fit(c, (pw, H), Image.LANCZOS)
        banner.paste(fitted, (idx * panel_w, 0))
    # Subtle dark gradient at bottom for readability
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for y in range(int(H * 0.55), H):
        alpha = int(170 * (y - H * 0.55) / (H * 0.45))
        draw.line([(0, y), (W, y)], fill=(0, 0, 0, alpha))
    banner = Image.alpha_composite(banner.convert("RGBA"), overlay).convert("RGB")
banner.save(cfg["outCover"], "JPEG", quality=88)

icon = ImageOps.fit(banner, (512, 512), Image.LANCZOS)
icon.save(cfg["outIcon"], "JPEG", quality=90)
print(f"Stitched {total} icons ({out_im.size[0]}x{out_im.size[1]}) + cover ({W}x{H})")
`;
  execFileSync(
    'python',
    [
      '-c',
      pyCode,
      JSON.stringify({ pictoPaths, coverPaths, outPicto, outCover, outIcon, iconSize, title }),
    ],
    { stdio: 'inherit' }
  );
}

async function main() {
  const args = process.argv.slice(2);
  const configPath = args.find((a) => !a.startsWith('--'));
  const doInstall = args.includes('--install');
  const force = args.includes('--force');

  if (!configPath) {
    console.error('Usage: node scripts/build-100p-mod.js <config.json> [--install] [--force]');
    process.exit(1);
  }

  if (doInstall && !force && isIncrediboxRunning()) {
    console.error('ERROR: Incredibox is currently running. Close the game before --install (or pass --force).');
    process.exit(1);
  }

  const cfg = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
  const workDir = path.resolve(cfg.workDir);
  const tmpDir = path.join(workDir, 'tmp');
  const outDir = path.join(workDir, 'out');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const masterBpm = Number(cfg.bpm || 120);
  const masterLooptime = Number(cfg.looptime || 8000);
  const masterTotalFrame = Number(cfg.totalframe || 384);
  const masterLoopFrames = masterTotalFrame / 2;
  const masterLoopSec = masterLooptime / 1000;
  const nbpolo = Number(cfg.nbpolo || 10);
  const useLd = cfg.spriteQuality ? cfg.spriteQuality === 'ld' : cfg.sources.length * 20 > 40;
  const iconSize = Number(cfg.iconSize || (useLd ? 68 : 112));

  console.log(
    `Building "${cfg.name}" (${cfg.sources.length} sources -> ${cfg.sources.length * 20} chars, ${nbpolo} polos, ${masterBpm} BPM, ${masterLooptime}ms, ${useLd ? 'LD' : 'HD'})...`
  );

  // 1. Load all sources
  const loaded = [];
  const pictoPaths = [];
  const coverPaths = [];

  for (let sIdx = 0; sIdx < cfg.sources.length; sIdx++) {
    const srcCfg = cfg.sources[sIdx];
    const src = loadSource(srcCfg, workDir);
    console.log(
      `  [${sIdx + 1}/${cfg.sources.length}] ${src.label}: ${src.characters.length} chars, ${src.bpm} BPM, ${src.looptime}ms${src.doubleLoop ? ' (2x loop)' : ''}`
    );
    if (src.characters.length !== 20) {
      throw new Error(`Expected 20 characters in ${src.label}, got ${src.characters.length}`);
    }
    const pictoFile = path.join(tmpDir, `picto_${sIdx}.png`);
    fs.writeFileSync(pictoFile, src.pictoBuf);
    pictoPaths.push(pictoFile);

    if (src.coverBuf) {
      const coverFile = path.join(tmpDir, `cover_${sIdx}.jpg`);
      fs.writeFileSync(coverFile, src.coverBuf);
      coverPaths.push(coverFile);
    }
    loaded.push(src);
  }

  // 2. Stitch picto strip + mashup cover
  const outPicto = path.join(outDir, 'game-picto.png');
  const outCover = path.join(outDir, 'home-screen.jpg');
  const outIcon = path.join(outDir, 'icon.jpg');
  stitchImagesWithPython({
    pictoPaths,
    coverPaths,
    outPicto,
    outCover,
    outIcon,
    iconSize,
    title: cfg.name,
  });

  // 3. Prepare audio stretch jobs + pack anime assets
  const pack = {};
  const animearray = [];
  const audioJobs = [];
  const audioDir = path.join(tmpDir, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });

  let globalCharIdx = 0;
  for (let sIdx = 0; sIdx < loaded.length; sIdx++) {
    const src = loaded[sIdx];
    const prefix = `m${sIdx + 1}`;
    for (let cIdx = 0; cIdx < src.characters.length; cIdx++) {
      const ch = src.characters[cIdx];
      const numStr = String(++globalCharIdx).padStart(3, '0');
      const safeName = `${numStr}_${prefix}_${ch.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      // When doubleLoop=true (e.g. 200 BPM 4.8s -> 9.6s -> 8.0s):
      // combine A+B (or A+A if uniqsnd) into 1 master 8.0s loop, so final uniqsnd = true!
      const finalUniqSnd = src.doubleLoop ? true : ch.uniqsnd;

      const spriteHeightLd = getPngHeight(ch.spriteLd) || Math.round(getPngHeight(ch.spriteHd) / 2);
      const resampledJson = normalizeAndResampleAnimeJson(ch.json, {
        srcTotalFrame: src.totalframe,
        srcUniqSnd: ch.uniqsnd,
        doubleLoop: src.doubleLoop,
        masterTotalFrame,
        spriteHeightLd,
      });
      pack[`anime/${safeName}.json`] = {
        dataURL: toDataURL(Buffer.from(JSON.stringify(resampledJson), 'utf8')),
      };
      if (useLd) {
        pack[`anime/${safeName}-ld.png`] = {
          dataURL: toDataURL(ch.spriteLd),
        };
      } else {
        pack[`anime/${safeName}.png`] = {
          dataURL: toDataURL(ch.spriteHd),
        };
      }

      animearray.push({
        name: safeName,
        color: ch.color,
        uniqsnd: finalUniqSnd,
      });

      // Audio jobs
      const inA = path.join(audioDir, `${safeName}_in_a.${ch.soundA.ext}`);
      fs.writeFileSync(inA, ch.soundA.buf);

      if (src.doubleLoop) {
        const effSrcMs = src.looptime * 2;
        const ratio = effSrcMs / masterLooptime;
        let inputs = [inA, inA];
        if (!ch.uniqsnd && ch.soundB) {
          const inB = path.join(audioDir, `${safeName}_in_b.${ch.soundB.ext}`);
          fs.writeFileSync(inB, ch.soundB.buf);
          inputs = [inA, inB];
        }
        const outA = path.join(audioDir, `${safeName}_a.ogg`);
        audioJobs.push({ key: `sound/ogg/${safeName}_a.ogg`, inputs, ratio, targetSec: masterLoopSec, outPath: outA });
      } else {
        const ratio = src.looptime / masterLooptime;
        const outA = path.join(audioDir, `${safeName}_a.ogg`);
        audioJobs.push({ key: `sound/ogg/${safeName}_a.ogg`, inputs: [inA], ratio, targetSec: masterLoopSec, outPath: outA });
        if (!ch.uniqsnd && ch.soundB) {
          const inB = path.join(audioDir, `${safeName}_in_b.${ch.soundB.ext}`);
          fs.writeFileSync(inB, ch.soundB.buf);
          const outB = path.join(audioDir, `${safeName}_b.ogg`);
          audioJobs.push({ key: `sound/ogg/${safeName}_b.ogg`, inputs: [inB], ratio, targetSec: masterLoopSec, outPath: outB });
        }
      }
    }
  }

  console.log(`Stretching ${audioJobs.length} audio loops to ${masterLoopSec.toFixed(3)}s (${AUDIO_CONCURRENCY} parallel)...`);
  const t0 = Date.now();
  await runPool(audioJobs, AUDIO_CONCURRENCY, async (job) => {
    await runFfmpegStretch(job);
    pack[job.key] = { dataURL: toDataURL(fs.readFileSync(job.outPath)) };
  });
  console.log(`Audio done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);

  // 4. Shared visuals (0_polo, game-bck, game-picto, cover/icon)
  const bckSource = loaded[cfg.backgroundSourceIndex ?? loaded.length - 1] || loaded[0];
  const poloSource = loaded.find((s) => (useLd ? s.poloLdBuf : s.poloHdBuf)) || loaded[0];

  if (useLd) {
    pack['anime/0_polo-ld.png'] = { dataURL: toDataURL(poloSource.poloLdBuf) };
  } else {
    pack['anime/0_polo.png'] = { dataURL: toDataURL(poloSource.poloHdBuf) };
  }
  pack['image/game-bck.jpg'] = { dataURL: toDataURL(bckSource.bckBuf) };
  pack['image/game-picto.png'] = { dataURL: toDataURL(fs.readFileSync(outPicto)) };

  const coverDataURL = toDataURL(fs.readFileSync(outCover));
  const iconDataURL = toDataURL(fs.readFileSync(outIcon));
  pack['image/home-screen.jpg'] = { dataURL: coverDataURL };
  pack['image/icon.jpg'] = { dataURL: iconDataURL };
  pack['image/crew.jpg'] = { dataURL: iconDataURL };

  // 5. app.json
  const versionId = cfg.versionId || stableVersionId(cfg.name);
  const modDate = cfg.date || new Date().toISOString().slice(0, 10);
  const formats = [useLd ? 'ld' : 'hd', 'ogg'];

  const appJson = {
    name: cfg.name,
    date: modDate,
    looptime: masterLooptime,
    bpm: masterBpm,
    totalframe: masterTotalFrame,
    nbpolo,
    bonusloopA: true,
    bonusendloopA: true,
    colors: cfg.colors || ['#14141c', '#222230', '#38384e', '#4f4f6e', '#6d6d96', '#9a9ac4'],
    animearray,
    bonusarray: [],
    credit: {
      crewname: cfg.crew || 'Mashup 100p',
      process: loaded.map((s) => `${s.label} (${s.bpm} BPM)`),
      thanks: 'Built with Incredibox ModLoader 100p Builder',
    },
    format: formats,
    modders: cfg.modders || ['Mashup 100p'],
  };

  pack['app.json'] = { dataURL: toDataURL(Buffer.from(JSON.stringify(appJson), 'utf8')) };

  const packStr = JSON.stringify(pack);
  const packBytes = Buffer.byteLength(packStr, 'utf8');
  const packOut = path.join(outDir, `${versionId}.json`);
  fs.writeFileSync(packOut, packStr, 'utf8');
  console.log(
    `Built pack ${packOut} (${Object.keys(pack).length} files, ${(packBytes / (1024 * 1024)).toFixed(2)} MB, versionId=${versionId}).`
  );

  if (doInstall) {
    const userDataModsDir = path.join(process.env.APPDATA, 'Incredibox', 'incredimods');
    fs.mkdirSync(userDataModsDir, { recursive: true });
    const destPack = path.join(userDataModsDir, `${versionId}.json`);
    fs.copyFileSync(packOut, destPack);

    const localModsPath = path.join(userDataModsDir, 'localmods.json');
    let localMods = [];
    if (fs.existsSync(localModsPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(localModsPath, `${localModsPath}.bak-${stamp}`);
      // Keep newest 5 backups
      const baks = fs
        .readdirSync(userDataModsDir)
        .filter((f) => f.startsWith('localmods.json.bak-'))
        .sort();
      while (baks.length > 5) {
        fs.rmSync(path.join(userDataModsDir, baks.shift()), { force: true });
      }
      localMods = JSON.parse(fs.readFileSync(localModsPath, 'utf8'));
    }

    const entry = {
      version: versionId,
      name: cfg.name,
      crew: cfg.crew || 'Mashup 100p',
      modders: cfg.modders || ['Mashup 100p'],
      date: modDate,
      icon: iconDataURL,
      format: formats,
      size: packBytes,
      modio: false,
    };

    const existingIdx = localMods.findIndex((m) => m.version === versionId);
    if (existingIdx !== -1) localMods[existingIdx] = entry;
    else localMods.push(entry);

    fs.writeFileSync(localModsPath, JSON.stringify(localMods), 'utf8');
    console.log(`Installed "${cfg.name}" (version=${versionId}) into ${userDataModsDir}`);
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
