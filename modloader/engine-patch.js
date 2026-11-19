'use strict';

// ---------------------------------------------------------------------------
// PC engine patch: more than 20 icons and a configurable nbpolo in script.min.js
//
// PC v1.2.9 script.min.js already uses the dynamic variables lQ (icon count) and
// pQ (polo count) in every game, audio and mix loop. Only 5 spots hardcode the
// 20-icon / 7-polo layout. Patching them once (with a .orig backup and a version
// marker) lets any PC incredimod with more than 20 characters or nbpolo != 7 run
// natively in the PC window. Standard 20-icon / 7-polo versions behave as before,
// except for the longer recording limit (patch 2).
//
// Every patch must match exactly once. If the game changes and one does not,
// nothing is written and the vanilla script is kept (or restored).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

// Bump the version suffix whenever PATCHES change: an older marker triggers a
// re-patch from script.min.js.orig on the next launch.
const MARKER = '/*INCREDIBOX_MODLOADER_100P_V3*/';
const MARKER_PREFIX = '/*INCREDIBOX_MODLOADER_100P_';

const PATCHES = [
  {
    // m2(): `lQ = animearray.length > 20 ? 20 : lQ` -> no cap.
    // 'animearray' is a hex-escaped literal in the obfuscated source.
    name: 'unlock-icon-cap',
    re: /lQ=\(lQ=px\['\\x61\\x6e\\x69\\x6d\\x65\\x61\\x72\\x72\\x61\\x79'\]\[([^\]]+)\]\)\>0x14\?0x14:lQ/g,
    rep: "lQ=(lQ=px['\\x61\\x6e\\x69\\x6d\\x65\\x61\\x72\\x72\\x61\\x79'][$1])",
  },
  {
    // pV(): `pQ = 7` -> app.json nbpolo (default 7). Also raises the recording
    // limit to >= 9999 s / >= 999 loops for every version, and defaults a missing
    // recminloop to 2 and recmintime to round(looptime s) * recminloop.
    name: 'dynamic-nbpolo-and-recmaxloop',
    re: /\bpQ=0x7\b/g,
    rep: 'pQ=(px&&(px.recmaxloop=Math.max(999,Math.ceil(9999000/(px.looptime||8000))),px.recminloop=px.recminloop||2,px.recmintime=px.recmintime||Math.round((px.looptime||8000)/1000)*px.recminloop),px&&px.nbpolo>0?px.nbpolo:0x7)',
  },
  {
    // window.onresize: polo width = W / 6.8 (7 polos). Scale it for pQ > 7 and
    // shrink the effective stage height `ak` by the same ratio, so 10 polos keep
    // the vanilla headroom instead of becoming smaller.
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
    // window.onresize: let modloader/renderer.js lay out > 20 pictos on every resize.
    name: 'resize-picto-hook',
    re: /\bpoloBlocGapX=av\/0x2,/g,
    rep: '(window.__mlLayoutPcPictos&&window.__mlLayoutPcPictos(lQ,pQ)),poloBlocGapX=av/0x2,',
  },
];

// Pure function: returns { ok: true, text } or { ok: false, error }.
function patchEngineSource(raw) {
  let patched = raw;
  for (const p of PATCHES) {
    const matches = patched.match(p.re);
    if (!matches || matches.length !== 1) {
      return {
        ok: false,
        error: `"${p.name}" matched ${matches ? matches.length : 0} time(s) (expected 1)`,
      };
    }
    patched = patched.replace(p.re, p.rep);
  }
  return { ok: true, text: MARKER + '\n' + patched };
}

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

// srcDir = resources/app/src. Never throws; reports through logger.
function ensurePcEnginePatched(srcDir, logger) {
  const scriptPath = path.join(srcDir, 'js', 'script.min.js');
  if (!fs.existsSync(scriptPath)) return 'missing';

  try {
    const current = fs.readFileSync(scriptPath, 'utf8');
    if (current.startsWith(MARKER)) return 'current';

    // The first launch keeps the vanilla script as .orig; later marker upgrades
    // always re-patch from that copy, never from an already patched script.
    const origPath = scriptPath + '.orig';
    let raw;
    if (fs.existsSync(origPath)) {
      raw = fs.readFileSync(origPath, 'utf8');
    } else {
      if (current.startsWith(MARKER_PREFIX)) {
        logger.warn('[EnginePatch] script.min.js is patched but script.min.js.orig is missing; leaving it as is.');
        return 'no-orig';
      }
      raw = current;
      fs.writeFileSync(origPath, raw, 'utf8');
    }

    const result = patchEngineSource(raw);
    if (!result.ok) {
      logger.warn(`[EnginePatch] Skipping script.min.js patch: ${result.error}.`);
      if (current !== raw) {
        // An older patch version is on disk: fall back to vanilla rather than run it.
        writeAtomic(scriptPath, raw);
        logger.warn('[EnginePatch] Restored the vanilla script.min.js from .orig.');
      }
      return 'skipped';
    }

    writeAtomic(scriptPath, result.text);
    logger.info('[EnginePatch] Patched script.min.js for >20 icons and configurable nbpolo.');
    return 'patched';
  } catch (err) {
    logger.error(`[EnginePatch] Failed to patch script.min.js: ${err.message}`);
    return 'error';
  }
}

module.exports = { MARKER, PATCHES, patchEngineSource, ensurePcEnginePatched };
