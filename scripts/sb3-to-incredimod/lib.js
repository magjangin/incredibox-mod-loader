'use strict';

// Shared CLI options for the sb3 -> incredimod converter.
//   --work <dir>     work folder: <dir>/src = extracted .sb3, <dir>/out = generated files
//                    (default: $SB3_WORK or the current directory)
//   --config <file>  mod settings (default: <work>/config.js), see configs/sprunke-kusoshi.js
//   --phase <n>      Scratch "phase" to convert (default 1)
//   --install        build-pack: copy into %APPDATA%\Incredibox\incredimods and register it
//   --measure-only   build-art: print the costume measurements only

const fs = require('fs');
const path = require('path');

function getOptions(argv = process.argv.slice(2)) {
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const work = path.resolve(get('--work', process.env.SB3_WORK || process.cwd()));
  const src = path.join(work, 'src');
  if (!fs.existsSync(path.join(src, 'project.json'))) {
    throw new Error(`${src}\\project.json not found. Run prepare.js first (see README.md).`);
  }
  const configPath = path.resolve(get('--config', path.join(work, 'config.js')));
  if (!fs.existsSync(configPath)) {
    throw new Error(`config not found: ${configPath} (copy configs/sprunke-kusoshi.js and edit it)`);
  }
  const config = require(configPath);
  const phase = get('--phase', '1');
  if (!config.phases[phase]) throw new Error(`config has no phase ${phase}`);
  return {
    work,
    src,
    out: path.join(work, 'out'),
    profileDir: path.join(work, '.edge-profile'),
    project: require(path.join(src, 'project.json')),
    config,
    phase,
    install: argv.includes('--install'),
    measureOnly: argv.includes('--measure-only'),
  };
}

module.exports = { getOptions };
