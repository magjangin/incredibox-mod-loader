'use strict';

// Zero-dependency ASAR extractor (used by setup-game.ps1 and build-100p-mod.js).
//   node extract-asar.js <app.asar> <destDir> [subDir]
// subDir (e.g. "app/asset-v1") extracts only that folder, written directly into destDir.

const fs = require('fs');
const path = require('path');

// ASAR entry names come from the archive (possibly third-party): refuse anything
// that could escape destDir.
function checkEntryName(name) {
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name)) {
    throw new Error(`Unsafe ASAR entry name: ${JSON.stringify(name)}`);
  }
}

function extractAsar(asarPath, destDir, subDir = '') {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const headerSizeBuf = Buffer.alloc(16);
    fs.readSync(fd, headerSizeBuf, 0, 16, 0);

    const hdrSize = headerSizeBuf.readUInt32LE(4);
    const jsonLen = headerSizeBuf.readUInt32LE(12);
    const dataBase = 8 + hdrSize;

    const jsonBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
    let root = JSON.parse(jsonBuf.toString('utf8'));

    for (const part of subDir.split('/').filter(Boolean)) {
      if (!root.files || !root.files[part]) {
        throw new Error(`ASAR path not found: ${subDir}`);
      }
      root = root.files[part];
    }

    let fileCount = 0;

    function walk(node, relPath) {
      if (node.files) {
        fs.mkdirSync(path.join(destDir, relPath), { recursive: true });
        for (const [name, child] of Object.entries(node.files)) {
          checkEntryName(name);
          walk(child, path.join(relPath, name));
        }
        return;
      }

      // Unpacked files live in app.asar.unpacked; links are not followed.
      if (node.unpacked || node.link) {
        return;
      }

      const outPath = path.join(destDir, relPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });

      const size = Number(node.size || 0);
      const offset = Number(node.offset || 0);
      const buf = Buffer.alloc(size);
      if (size > 0) {
        fs.readSync(fd, buf, 0, size, dataBase + offset);
      }
      fs.writeFileSync(outPath, buf);
      fileCount += 1;
    }

    walk(root, '');
    return fileCount;
  } finally {
    fs.closeSync(fd);
  }
}

if (require.main === module) {
  const [asarPath, destDir, subDir] = process.argv.slice(2);
  if (!asarPath || !destDir) {
    console.error('Usage: node extract-asar.js <app.asar> <destDir> [subDir]');
    process.exit(1);
  }
  const count = extractAsar(path.resolve(asarPath), path.resolve(destDir), subDir || '');
  console.log(`Extracted ${count} files to ${path.resolve(destDir)}`);
}

module.exports = { extractAsar };
