'use strict';

// One command for the whole pipeline: [prepare] -> per phase: art + audio (in parallel) -> pack.
// usage: node convert.js [<project.sb3>] --work <dir> [--config <file>] [--phase <n>|all] [--install [--force]]
//   <project.sb3>  given: (re-)extract it first; a missing config.js is auto-generated
//   --phase        default: every phase in the config
// Keep <work> outside the git repository: the project's art and sounds belong to its creator.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { gameRunning } = require('./lib');

const argv = process.argv.slice(2);
const get = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const sb3 = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv[0]) : null;
const work = get('--work') && path.resolve(get('--work'));
if (!work) {
  console.error('usage: node convert.js [<project.sb3>] --work <dir> [--config <file>] [--phase <n>|all] [--install [--force]]');
  process.exit(1);
}
const install = argv.includes('--install');
const force = argv.includes('--force');
const configArg = get('--config');

function run(script, args, tag) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, script), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const prefix = (d) =>
      String(d)
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => `[${tag}] ${l}`)
        .join('\n') + '\n';
    p.stdout.on('data', (d) => process.stdout.write(prefix(d)));
    p.stderr.on('data', (d) => process.stderr.write(prefix(d)));
    p.on('error', reject);
    p.on('close', (code) => {
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`[${tag}] done in ${sec} s`);
        resolve(sec);
      } else reject(new Error(`${script} failed (exit ${code})`));
    });
  });
}

(async () => {
  const t0 = Date.now();
  // Fail fast instead of after the build: the game would overwrite localmods.json.
  if (install && !force && gameRunning()) {
    throw new Error('Incredibox is running. Close the game before --install, or pass --force.');
  }
  if (sb3) await run('prepare.js', [sb3, '--work', work], 'prepare');

  const configPath = configArg ? path.resolve(configArg) : path.join(work, 'config.js');
  if (!fs.existsSync(configPath)) throw new Error(`config not found: ${configPath}`);
  const config = require(configPath);
  const want = get('--phase');
  const phases = want && want !== 'all' ? [want] : Object.keys(config.phases);
  const common = ['--work', work, ...(configArg ? ['--config', configPath] : [])];

  for (const phase of phases) {
    const args = [...common, '--phase', phase];
    // art (headless Edge) and audio (ffmpeg) are independent
    await Promise.all([run('build-art.js', args, `art ${phase}`), run('build-audio.js', args, `audio ${phase}`)]);
    await run('build-pack.js', [...args, ...(install ? ['--install'] : []), ...(force ? ['--force'] : [])], `pack ${phase}`);
  }
  console.log(`convert done: ${phases.length} phase(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
