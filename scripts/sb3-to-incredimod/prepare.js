'use strict';

// Extract a Scratch project (.sb3 = zip) into <work>/src and drop a config.js template.
// usage: node prepare.js <project.sb3> --work <dir>
// Keep <work> outside the git repository: the project's art and sounds belong to its creator.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const sb3 = argv[0] && !argv[0].startsWith('--') ? path.resolve(argv[0]) : null;
const wi = argv.indexOf('--work');
const work = wi >= 0 && argv[wi + 1] ? path.resolve(argv[wi + 1]) : null;
if (!sb3 || !work) {
  console.error('usage: node prepare.js <project.sb3> --work <dir>');
  process.exit(1);
}
if (!fs.existsSync(sb3)) {
  console.error(`not found: ${sb3}`);
  process.exit(1);
}

const src = path.join(work, 'src');
fs.rmSync(src, { recursive: true, force: true });
fs.mkdirSync(src, { recursive: true });
fs.copyFileSync(sb3, path.join(work, 'original.sb3'));

// Windows 10+ ships bsdtar, which reads zip archives.
const tar = process.platform === 'win32' ? path.join(process.env.WINDIR, 'System32', 'tar.exe') : 'tar';
execFileSync(tar, ['-xf', path.join(work, 'original.sb3'), '-C', src], { stdio: 'inherit' });

const project = JSON.parse(fs.readFileSync(path.join(src, 'project.json'), 'utf8'));
console.log(`extracted ${fs.readdirSync(src).length} files -> ${src}`);
console.log('sprites:');
project.targets.forEach((t, i) =>
  console.log(`  ${String(i).padStart(2)} ${t.isStage ? '[stage] ' : ''}${t.name}  (costumes ${t.costumes.length}, sounds ${t.sounds.length})`)
);

const cfg = path.join(work, 'config.js');
if (!fs.existsSync(cfg)) {
  fs.copyFileSync(path.join(__dirname, 'configs', 'sprunke-kusoshi.js'), cfg);
  console.log(`\nwrote ${cfg} from the Sprunke Kusoshi example - edit names, phases and slugs before building.`);
}
