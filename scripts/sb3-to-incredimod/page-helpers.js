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
  async measure({ url, rcx, rcy, res, scale }) {
    const img = await H.load(url);
    const k = 2; // oversample
    const s = (scale / res) * k;
    const pad = 1200;
    const c = H.canvas(pad * 2, pad * 2);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, pad - rcx * s, pad - rcy * s, img.width * s, img.height * s);
    const b = H.alphaBox(ctx, c.width, c.height);
    if (!b) return null;
    return b.map((v) => (v - pad) / k);
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
