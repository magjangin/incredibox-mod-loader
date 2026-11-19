// Build Incredibox A/B loops (exactly loopSec each) per character by replaying what Scratch plays:
// Loop 1 sounds at t, Loop 2 sounds at loopSec + t, repeating; a sound restarting cuts its previous
// instance (Scratch behaviour); tails of other sounds overlap into the next loop. Three cycles are
// rendered and the last (steady-state) cycle is split into A and B.
// usage: node build-audio.js --work <dir> [--config <file>] [--phase 1]   (needs ffmpeg with libvorbis)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { simulate } = require('./timeline');
const { getOptions } = require('./lib');

const opts = getOptions();
const { config, phase, project } = opts;
const SRC = opts.src;
const P = config.phases[phase];
const OUT = path.join(opts.out, `phase${phase}`, 'sound', 'ogg');
const RATE = 44100;
const CH = 2;
// ffmpeg runs as async child processes (PCM over stdin/stdout, no temp files), JOBS at a time.
const JOBS = Math.max(1, Math.min(8, os.cpus().length));

function ffmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg exit ${code}: ${err}`))));
    p.stdin.on('error', () => {}); // ffmpeg may exit early; 'close' reports the failure
    p.stdin.end(input);
  });
}

async function decode(file) {
  const buf = await ffmpeg(['-v', 'error', '-i', file, '-f', 'f32le', '-ac', String(CH), '-ar', String(RATE), '-']);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function encode(samples, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return ffmpeg(
    ['-v', 'error', '-y', '-f', 'f32le', '-ac', String(CH), '-ar', String(RATE), '-i', 'pipe:0', '-c:a', 'libvorbis', '-q:a', '6', file],
    Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  );
}

// Run async task functions with at most JOBS in flight; results keep the task order.
async function pool(tasks) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, tasks.length) }, worker));
  return results;
}

(async () => {
  const sim = simulate(project, {
    phase,
    loopSec: P.loopSec,
    framesPerLoop: P.framesPerLoop,
    idles: config.characters.map((c) => c.idle),
  });
  const chars = project.targets.slice(1, 21);
  const loopN = Math.round(P.loopSec * RATE);
  const cycles = 3;
  const total = loopN * 2 * cycles;
  const fileOf = (t, name) => {
    const meta = t.sounds.find((x) => x.name === name);
    return path.join(SRC, meta.md5ext || `${meta.assetId}.${meta.dataFormat}`);
  };

  // 1) decode every sound that is played, in parallel
  const files = new Set();
  chars.forEach((t, i) => [...sim[i].soundsA, ...sim[i].soundsB].forEach((s) => files.add(fileOf(t, s.sound))));
  const list = [...files];
  const pcms = await pool(list.map((f) => () => decode(f)));
  const cache = new Map(list.map((f, i) => [f, pcms[i]]));

  // 2) mix each character (CPU, sequential), then 3) encode all A/B loops in parallel
  const encodes = [];
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
      const pcm = cache.get(fileOf(t, st.sound));
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
    const a = seg(0);
    const b = seg(loopN);
    encodes.push(() => encode(a, path.join(OUT, `${id}_a.ogg`)));
    encodes.push(() => encode(b, path.join(OUT, `${id}_b.ogg`)));
    console.log(
      `${id.padEnd(18)} A:${sim[i].soundsA.map((s) => s.sound).join('+')}  B:${sim[i].soundsB.map((s) => s.sound).join('+')}  peak ${peak.toFixed(2)}${gain !== 1 ? ` (gain ${gain.toFixed(2)})` : ''}`
    );
  }
  await pool(encodes);
  fs.rmSync(path.join(opts.out, 'tmp'), { recursive: true, force: true }); // left over by older versions
  console.log(`audio done -> ${OUT} (${list.length} decodes, ${encodes.length} encodes, ${JOBS} jobs)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
