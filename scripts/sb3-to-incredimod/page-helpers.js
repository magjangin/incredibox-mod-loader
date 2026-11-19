// Runs inside the headless browser page. All images arrive as data URLs.
window.H = {
  load(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = url;
    });
  },
  canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  },
  alphaBox(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return maxX < 0 ? null : [minX, minY, maxX + 1, maxY + 1];
  },
  // Bounding box of a costume in stage units relative to its rotation center.
  // The canvas only covers the drawn image (was a fixed 2400x2400 scan per costume). The integer
  // part of the draw offset moves into ix/iy, so the fractional offset - and thus the rasterized
  // alpha - is the same as drawing at (pad - rc*s) on the big canvas.
  async measure({ url, rcx, rcy, res, scale }) {
    const img = await H.load(url);
    const k = 2; // oversample
    const s = (scale / res) * k;
    const pad = 1200;
    const x0 = pad - rcx * s, y0 = pad - rcy * s;
    const ix = Math.floor(x0), iy = Math.floor(y0);
    const c = H.canvas(Math.ceil(img.width * s) + 2, Math.ceil(img.height * s) + 2);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, x0 - ix, y0 - iy, img.width * s, img.height * s);
    const b = H.alphaBox(ctx, c.width, c.height);
    if (!b) return null;
    return [b[0] + ix, b[1] + iy, b[2] + ix, b[3] + iy].map((v) => (v - pad) / k);
  },
  // Measure several costumes in one round trip (images decode in parallel).
  async measureAll(specs) {
    return Promise.all(specs.map((s) => H.measure(s)));
  },
  // Draw a costume into ctx so its rotation center lands at (ax, ay); px = LD/HD pixels per stage unit.
  async drawCostume(ctx, { url, rcx, rcy, res, scale }, ax, ay, px) {
    const img = await H.load(url);
    const s = (scale / res) * px;
    ctx.drawImage(img, ax - rcx * s, ay - rcy * s, img.width * s, img.height * s);
  },
  // Fit an image into a w x h box (keep aspect), centered.
  async drawFit(ctx, url, x, y, w, h, pad = 0) {
    const img = await H.load(url);
    const r = Math.min((w - 2 * pad) / img.width, (h - 2 * pad) / img.height);
    const dw = img.width * r, dh = img.height * r;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  },
  async drawCover(ctx, url, w, h) {
    const img = await H.load(url);
    const r = Math.max(w / img.width, h / img.height);
    const dw = img.width * r, dh = img.height * r;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  },
  silhouette(srcCanvas, sx, sy, w, h, color) {
    const c = H.canvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(srcCanvas, sx, sy, w, h, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    return c;
  },
  avgColor(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 200) {
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
    }
    if (!n) return '#777777';
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
    return '#' + hex(r) + hex(g) + hex(b);
  },
};
'helpers ready';
