// Build Incredibox A/B loops (exactly loopSec each) per character by replaying what Scratch plays:
// Loop 1 sounds at t, Loop 2 sounds at loopSec + t, repeating; a sound restarting cuts its previous
// instance (Scratch behaviour); tails of other sounds overlap into the next loop. Three cycles are
// rendered and the last (steady-state) cycle is split into A and B.
// usage: node build-audio.js --work <dir> [--config <file>] [--phase 1]   (needs ffmpeg with libvorbis)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { simulate } = require('./timeline');
const { getOptions } = require('./lib');

const opts = getOptions();
const { config, phase, project } = opts;
const SRC = opts.src;
const P = config.phases[phase];
const OUT = path.join(opts.out, `phase${phase}`, 'sound', 'ogg');
const TMP = path.join(opts.out, 'tmp');
const RATE = 44100;
const CH = 2;

function decode(file) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', String(CH), '-ar', String(RATE), '-'], {
    maxBuffer: 1 << 30,
  });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function encode(samples, file) {
  fs.mkdirSync(TMP, { recursive: true });
  const raw = path.join(TMP, 'seg.f32');
  fs.writeFileSync(raw, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'f32le', '-ac', String(CH), '-ar', String(RATE), '-i', raw,
    '-c:a', 'libvorbis', '-q:a', '6', file,
  ]);
}

const sim = simulate(project, { phase, loopSec: P.loopSec, framesPerLoop: P.framesPerLoop });
const chars = project.targets.slice(1, 21);
const loopN = Math.round(P.loopSec * RATE);
const cycles = 3;
const total = loopN * 2 * cycles;
const cache = new Map();

for (let i = 0; i < chars.length; i++) {
  const t = chars[i];
  const id = `${i + 1}_${config.characters[i].slug}`;
  const starts = [];
  for (let c = 0; c < cycles; c++) {
    for (const s of sim[i].soundsA) starts.push({ at: c * 2 * loopN + Math.round(s.t * RATE), sound: s.sound });
    for (const s of sim[i].soundsB) starts.push({ at: c * 2 * loopN + loopN + Math.round(s.t * RATE), sound: s.sound });
  }
  starts.sort((a, b) => a.at - b.at);
  const mix = new Float32Array(total * CH);
  for (let j = 0; j < starts.length; j++) {
    const st = starts[j];
    const meta = t.sounds.find((x) => x.name === st.sound);
    const file = path.join(SRC, meta.md5ext || `${meta.assetId}.${meta.dataFormat}`);
    if (!cache.has(file)) cache.set(file, decode(file));
    const pcm = cache.get(file);
    const next = starts.slice(j + 1).find((x) => x.sound === st.sound);
    const end = Math.min(total, st.at + pcm.length / CH, next ? next.at : Infinity);
    for (let f = st.at; f < end; f++) {
      const src = (f - st.at) * CH;
      mix[f * CH] += pcm[src];
      mix[f * CH + 1] += pcm[src + 1];
    }
  }
  let peak = 0;
  const last = (cycles - 1) * 2 * loopN;
  for (let f = last * CH; f < total * CH; f++) peak = Math.max(peak, Math.abs(mix[f]));
  const gain = peak > 0.98 ? 0.98 / peak : 1;
  const seg = (from) => {
    const out = mix.slice((last + from) * CH, (last + from + loopN) * CH);
    if (gain !== 1) for (let k = 0; k < out.length; k++) out[k] *= gain;
    return out;
  };
  encode(seg(0), path.join(OUT, `${id}_a.ogg`));
  encode(seg(loopN), path.join(OUT, `${id}_b.ogg`));
  console.log(
    `${id.padEnd(18)} A:${sim[i].soundsA.map((s) => s.sound).join('+')}  B:${sim[i].soundsB.map((s) => s.sound).join('+')}  peak ${peak.toFixed(2)}${gain !== 1 ? ` (gain ${gain.toFixed(2)})` : ''}`
  );
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`audio done -> ${OUT}`);
