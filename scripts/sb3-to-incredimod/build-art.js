// Render Incredibox character sheets (+frame JSON), icon sheet and cover images from the sb3.
// usage: node build-art.js --work <dir> [--config <file>] [--phase 1] [--measure-only]
const fs = require('fs');
const path = require('path');
const { launch } = require('./edge');
const { simulate } = require('./timeline');
const { getOptions } = require('./lib');

const opts = getOptions();
const { config, phase, measureOnly, project } = opts;
const SRC = opts.src;
const P = config.phases[phase];
const OUT = path.join(opts.out, `phase${phase}`);

const CELL_W = 164; // LD units (HD = x2)
const CELL_H = 380;
const COLS = 10;
// In-game layout (v1.2.9 script.min.js, `iy.canvas` / `iy.polo`, LD px): canvas 1100x430, polo
// drawn width iv = W/6.8 (scale iq = iv/164), slot spacing ix = (W - iv - marge/2)/6, a character
// sheet's top is at H - 380*iq + random(0..30)*iq, so its bottom sits on the canvas bottom.
const GAME = (() => {
  const W = 1100, Hc = 430, iv = W / 6.8, iq = iv / 164;
  return { W, H: Hc, iq, slot: (W - iv - 200 / 2) / 6, sheetTop: Hc - CELL_H * iq + 15 * iq };
})();

function costumeSpec(target, name) {
  const c = target.costumes.find((x) => x.name === name);
  if (!c) throw new Error(`${target.name}: costume ${name} missing`);
  const file = path.join(SRC, c.md5ext || `${c.assetId}.${c.dataFormat}`);
  const mime = c.dataFormat === 'svg' ? 'image/svg+xml' : c.dataFormat === 'png' ? 'image/png' : 'image/jpeg';
  return {
    name,
    url: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`,
    rcx: c.rotationCenterX,
    rcy: c.rotationCenterY,
    res: c.bitmapResolution || 1,
    scale: (target.size || 100) / 100,
  };
}

function writeDataUrl(file, dataUrl) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

(async () => {
  const sim = simulate(project, {
    phase,
    loopSec: P.loopSec,
    framesPerLoop: P.framesPerLoop,
    idles: config.characters.map((c) => c.idle),
  });
  const chars = project.targets.slice(1, 21);
  const browser = await launch({ profileDir: opts.profileDir });
  try {
    // 1) measure union bbox (stage units, relative to rotation center) of every used costume
    const plan = [];
    for (let i = 0; i < chars.length; i++) {
      const t = chars[i];
      const s = sim[i];
      const used = [...new Set([s.idle, ...s.A, ...s.B])];
      const specs = used.map((n) => costumeSpec(t, n));
      let box = null;
      let idleBox = null;
      const boxes = await browser.evaluate(`H.measureAll(${JSON.stringify(specs)})`);
      for (let j = 0; j < specs.length; j++) {
        const spec = specs[j];
        const b = boxes[j];
        if (!b) continue;
        if (spec.name === s.idle) idleBox = b;
        box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
      }
      plan.push({ index: i, target: t, sim: s, used, specs, box, idleBox: idleBox || box });
    }

    const fits = plan.map((p) => Math.min((CELL_W - 4) / (p.box[2] - p.box[0]), (CELL_H - 4) / (p.box[3] - p.box[1])));
    const sorted = [...fits].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const kFull = Math.min(...fits.filter((f) => f >= median * 0.75));
    const maxY = Math.max(...plan.map((p) => p.box[3]));
    const mode = (config.framing && config.framing.mode) || 'full';
    const upper = mode === 'upper';
    const scratch = mode === 'scratch';
    // scratch + slotUnits: same character size relative to the slot spacing as in the original
    // (the game spaces slots GAME.slot px apart but draws sheets at GAME.iq)
    const kScratch = scratch && config.framing.slotUnits ? GAME.slot / config.framing.slotUnits / GAME.iq : null;
    const k = scratch ? kScratch || config.framing.k : upper ? kFull * config.framing.scale : kFull;
    // full: common ground line; upper: idle head top at framing.headTop (+ headroom, max 36 LD px,
    // for poses that rise above the idle head); scratch: fixed rotation-center line like the original
    const headroom = (p) => Math.min(36, Math.max(0, (p.idleBox[1] - p.box[1]) * k));
    const baseY = (p) =>
      scratch
        ? config.framing.charY
        : upper
          ? config.framing.headTop + headroom(p) - k * p.idleBox[1]
          : CELL_H - 2 - k * maxY;
    // characters[i].dy (LD px, + = down) nudges one character, e.g. a tall hood clipped at the top;
    // framing.fitTop computes it for characters without dy so the union box starts at y >= 2
    const dyOf = (p) => {
      const dy = config.characters[p.index].dy;
      if (dy !== undefined) return dy;
      if (!config.framing || !config.framing.fitTop) return 0;
      return Math.max(0, Math.ceil(2 - (baseY(p) + k * p.box[1])));
    };
    const anchorY = (p) => dyOf(p) + baseY(p);
    const ay = anchorY(plan[0]);
    console.log(`framing ${mode}: k=${k.toFixed(3)} LD px/stage unit (full-body k ${kFull.toFixed(3)})`);
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      const w = (p.box[2] - p.box[0]) * k;
      const h = (p.box[3] - p.box[1]) * k;
      const top = anchorY(p) + k * p.box[1];
      console.log(
        `${String(i + 1).padStart(2)} ${p.target.name.padEnd(18)} fit ${fits[i].toFixed(3)} -> ${w.toFixed(0)}x${h.toFixed(0)} LD, top ${top.toFixed(0)}${w > CELL_W || top < 0 ? '  (CLIPPED)' : ''} | costumes ${p.used.length}${config.characters[i].dy === undefined && dyOf(p) ? ` | fitTop dy ${dyOf(p)}` : ''}`
      );
    }
    if (measureOnly) return;

    // 2) character sheets
    const animearray = [];
    for (const p of plan) {
      const meta = config.characters[p.index];
      const id = `${p.index + 1}_${meta.slug}`;
      // Center on the union box when it fits, otherwise on the idle body so wide poses clip evenly.
      const unionW = (p.box[2] - p.box[0]) * k;
      const ref = !upper && unionW <= CELL_W - 2 ? p.box : p.idleBox;
      // scratch: rotation center at the slot center, exactly like "go to Polo N" in the original
      const ax = scratch ? CELL_W / 2 : CELL_W / 2 - (k * (ref[0] + ref[2])) / 2;
      const ay = anchorY(p);
      const cells = p.used.filter((n) => n !== '__none__');
      const rows = 1 + Math.ceil(cells.length / COLS);
      const sheet = await browser.evaluate(`(async () => {
        const specs = ${JSON.stringify(p.specs)};
        const cells = ${JSON.stringify(cells)};
        const idle = ${JSON.stringify(p.sim.idle)};
        const out = {};
        for (const [label, px] of [['hd', 2], ['ld', 1]]) {
          const cw = ${CELL_W} * px, ch = ${CELL_H} * px;
          const c = H.canvas(Math.max(3, ${COLS}) * cw, ${rows} * ch);
          const ctx = c.getContext('2d');
          const bySpec = Object.fromEntries(specs.map((s) => [s.name, s]));
          // row 0: idle | (blank body) | silhouette
          ctx.save();
          ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.clip();
          await H.drawCostume(ctx, bySpec[idle], ${ax} * px, ${ay} * px, ${k} * px);
          ctx.restore();
          const sil = H.silhouette(c, 0, 0, cw, ch, '#000000');
          ctx.drawImage(sil, 2 * cw, 0);
          for (let i = 0; i < cells.length; i++) {
            const x = (i % ${COLS}) * cw, y = (1 + Math.floor(i / ${COLS})) * ch;
            ctx.save();
            ctx.beginPath(); ctx.rect(x, y, cw, ch); ctx.clip();
            await H.drawCostume(ctx, bySpec[cells[i]], x + ${ax} * px, y + ${ay} * px, ${k} * px);
            ctx.restore();
          }
          out[label] = c.toDataURL('image/png');
        }
        return out;
      })()`);
      const cellPos = Object.fromEntries(
        cells.map((n, i) => [n, [(i % COLS) * CELL_W, (1 + Math.floor(i / COLS)) * CELL_H]])
      );
      const frames = [...p.sim.A, ...p.sim.B].map((n) => ({ prop: `${cellPos[n][0]},${cellPos[n][1]},0,0` }));
      const json = {
        animeName: id,
        width: String(CELL_W),
        height: String(CELL_H),
        headHeight: String(CELL_H),
        version: '1',
        arrayFrame: frames,
      };
      writeDataUrl(path.join(OUT, 'anime', `${id}.png`), sheet.hd);
      writeDataUrl(path.join(OUT, 'anime', `${id}-ld.png`), sheet.ld);
      fs.writeFileSync(path.join(OUT, 'anime', `${id}.json`), JSON.stringify(json, null, '\t'));
      animearray.push({ name: id, slug: meta.slug, title: p.target.name });
      console.log(`sheet ${id}: ${cells.length} cells, ${frames.length} frames`);
    }

    // 3) icons (HD 136x136, row 0 = normal "-a", row 1 = used "-c") + per-character colors
    const iconsT = project.targets.find((t) => t.name === 'Icons');
    const iconUrl = (n) => costumeSpec(iconsT, n).url;
    const iconList = plan.map((p) => {
      const nn = String(p.index + 1).padStart(2, '0');
      return { a: iconUrl(`${nn}-a`), c: iconUrl(`${nn}-c`) };
    });
    const icons = await browser.evaluate(`(async () => {
      const list = ${JSON.stringify(iconList)};
      const S = 136, c = H.canvas(S * list.length, S * 2), ctx = c.getContext('2d');
      const colors = [];
      for (let i = 0; i < list.length; i++) {
        await H.drawFit(ctx, list[i].a, i * S, 0, S, S, 6);
        await H.drawFit(ctx, list[i].c, i * S, S, S, S, 6);
        const t = H.canvas(S, S); const tctx = t.getContext('2d');
        await H.drawFit(tctx, list[i].a, 0, 0, S, S, 6);
        colors.push(H.avgColor(tctx, S, S));
      }
      return { png: c.toDataURL('image/png'), colors };
    })()`);
    writeDataUrl(path.join(OUT, 'image', 'game-picto.png'), icons.png);
    animearray.forEach((a, i) => (a.color = icons.colors[i]));

    // 3b) empty-slot polo sprite (game layout, LD 656x480 / HD x2):
    //     base 164x400 at (0,0) | overlay silhouette at (164,0) | eyelids x=328 | eyes x=492.
    //     Only the base is drawn; overlay and eye strips stay transparent (no blinking face).
    if (scratch && config.panelCostume && config.panelCostume[phase]) {
      const panelT = project.targets.find((t) => t.name === config.framing.panelTarget);
      const panel = costumeSpec(panelT, config.panelCostume[phase]);
      const polo = await browser.evaluate(`(async () => {
        const out = {};
        for (const [label, px] of [['hd', 2], ['ld', 1]]) {
          const c = H.canvas(656 * px, 480 * px), ctx = c.getContext('2d');
          ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 164 * px, 400 * px); ctx.clip();
          await H.drawCostume(ctx, ${JSON.stringify(panel)}, 82 * px, ${config.framing.panelY} * px, ${k} * px);
          ctx.restore();
          out[label] = c.toDataURL('image/png');
        }
        return out;
      })()`);
      writeDataUrl(path.join(OUT, 'anime', '0_polo.png'), polo.hd);
      writeDataUrl(path.join(OUT, 'anime', '0_polo-ld.png'), polo.ld);
      console.log('polo panel sprite written');
    }

    // 4) backgrounds / cover
    const stage = project.targets[0];
    const preview = project.targets.find((t) => t.name === 'Preview');
    const bgSpec = costumeSpec(stage, P.backdrop);
    const bg = bgSpec.url;
    // no Preview sprite / cover costume: the cover screens use the backdrop
    const cover = preview && config.coverCostume ? costumeSpec(preview, config.coverCostume).url : bg;
    // background.mode 'stage': draw the backdrop in the characters' coordinate system, so stage
    // point (0, slotY) - the slot rotation centers - lands where the game draws charY. Otherwise
    // the backdrop image covers the frame.
    let stageBg = null;
    if (config.background && config.background.mode === 'stage' && scratch) {
      const hdPerCanvas = 2048 / GAME.W;
      const unit = k * GAME.iq; // canvas px per stage unit
      const centerY = GAME.sheetTop + config.framing.charY * GAME.iq + config.background.slotY * unit;
      stageBg = { x: 1024, y: centerY * hdPerCanvas, px: unit * hdPerCanvas, fill: config.background.fill || '#000000' };
      console.log(`background: stage-aligned, ${stageBg.px.toFixed(3)} HD px/unit, stage (0,0) at y ${stageBg.y.toFixed(0)}`);
    }
    const imgs = await browser.evaluate(`(async () => {
      const bg = ${JSON.stringify(bg)}, cover = ${JSON.stringify(cover)};
      const bgSpec = ${JSON.stringify(bgSpec)}, stageBg = ${JSON.stringify(stageBg)};
      const jpg = async (w, h, withCover) => {
        const c = H.canvas(w, h), ctx = c.getContext('2d');
        if (stageBg && !withCover) {
          ctx.fillStyle = stageBg.fill;
          ctx.fillRect(0, 0, w, h);
          await H.drawCostume(ctx, bgSpec, stageBg.x * w / 2048, stageBg.y * w / 2048, stageBg.px * w / 2048);
        } else await H.drawCover(ctx, bg, w, h);
        if (withCover) await H.drawFit(ctx, cover, 0, 0, w, h, Math.round(h * 0.04));
        return c.toDataURL('image/jpeg', 0.9);
      };
      return {
        bck: await jpg(2048, 800, false),
        home: await jpg(2976, 1420, true),
        icon: await jpg(512, 512, true),
      };
    })()`);
    writeDataUrl(path.join(OUT, 'image', 'game-bck.jpg'), imgs.bck);
    writeDataUrl(path.join(OUT, 'image', 'home-screen.jpg'), imgs.home);
    writeDataUrl(path.join(OUT, 'image', 'icon.jpg'), imgs.icon);
    writeDataUrl(path.join(OUT, 'image', 'crew.jpg'), imgs.icon);

    fs.writeFileSync(path.join(OUT, 'art.json'), JSON.stringify({ phase, k, animearray }, null, 2));
    console.log(`art done -> ${OUT}`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
