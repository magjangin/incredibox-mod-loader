'use strict';

const fs = require('fs');
const path = require('path');

function extractAsar(asarPath, destDir) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const headerSizeBuf = Buffer.alloc(16);
    fs.readSync(fd, headerSizeBuf, 0, 16, 0);

    const hdrSize = headerSizeBuf.readUInt32LE(4);
    const jsonLen = headerSizeBuf.readUInt32LE(12);
    const dataBase = 8 + hdrSize;

    const jsonBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));

    let fileCount = 0;

    function walk(node, relPath) {
      if (node.files) {
        const dirPath = path.join(destDir, relPath);
        fs.mkdirSync(dirPath, { recursive: true });
        for (const [name, child] of Object.entries(node.files)) {
          walk(child, path.join(relPath, name));
        }
        return;
      }

      if (node.unpacked) {
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

    walk(header, '');
    return fileCount;
  } finally {
    fs.closeSync(fd);
  }
}

if (require.main === module) {
  const [asarPath, destDir] = process.argv.slice(2);
  if (!asarPath || !destDir) {
    console.error('Usage: node extract-asar.js <app.asar> <destDir>');
    process.exit(1);
  }
  const count = extractAsar(path.resolve(asarPath), path.resolve(destDir));
  console.log(`Extracted ${count} files to ${path.resolve(destDir)}`);
}

module.exports = { extractAsar };
