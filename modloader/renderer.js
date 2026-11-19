(() => {
  if (window.IncrediboxModLoader) return;

  const init = window.__INCREDIBOX_MODLOADER_INIT__ || {
    version: '0.3.1',
    mods: [],
    apkMods: [],
    isApkMode: false,
    pcIndexUrl: '',
  };

  const api = {
    version: init.version,
    mods: [],
    apkMods: init.apkMods || [],
    isApkMode: Boolean(init.isApkMode),
    logs: [],
    log(modId, ...args) {
      const text = `[ModLoader:${modId}] ${args.map(String).join(' ')}`;
      api.logs.push(text);
      console.log(text);
    },
    launchApkMod(id) {
      const found = api.apkMods.find((m) => m.id === id);
      if (found && found.entryUrl) {
        window.location.href = found.entryUrl;
      }
    },
    backToPc() {
      if (init.pcIndexUrl) {
        window.location.href = init.pcIndexUrl;
      }
    },
    toggleOverlay() {
      const el = document.getElementById('incredibox-modloader-overlay');
      if (el) {
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
      }
    },
  };

  window.IncrediboxModLoader = api;

  // Mod/APK metadata is third-party text: never interpolate it into innerHTML raw.
  const escapeHtml = (value) =>
    String(value == null ? '' : value).replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );

  // Screen scale & fullscreen helpers for APK mode (100-char / 10-polo layouts)
  const SCALE_KEY = 'incredibox_modloader_apk_scale';
  let apkScale = parseFloat(localStorage.getItem(SCALE_KEY) || '0.9');
  if (Number.isNaN(apkScale) || apkScale < 0.5 || apkScale > 1.2) apkScale = 0.9;

  function applyApkScale(val) {
    apkScale = Math.round(val * 100) / 100;
    localStorage.setItem(SCALE_KEY, String(apkScale));
    if (!api.isApkMode) return;
    document.documentElement.style.background = '#0c0c0e';
    document.documentElement.style.overflow = 'hidden';
    if (apkScale === 1) {
      document.body.style.transform = '';
      document.body.style.transformOrigin = '';
    } else {
      document.body.style.transform = `scale(${apkScale})`;
      document.body.style.transformOrigin = 'center center';
    }
    const label = document.getElementById('incredibox-apk-scale-val');
    if (label) label.textContent = `${Math.round(apkScale * 100)}%`;
  }

  if (api.isApkMode) {
    applyApkScale(apkScale);

    // Auto-arrange >20 picto icons into a clean, centered 20-column grid with 5-icon group gaps
    let lastLaidOutCount = 0;
    function layoutApkPictos(force = false) {
      const box = document.getElementById('box-picto');
      if (!box) return;
      const pictos = Array.from(box.querySelectorAll('.picto'));
      if (pictos.length <= 20) return;
      if (!force && pictos.length === lastLaidOutCount) return;
      lastLaidOutCount = pictos.length;

      const cols = 20;
      const iconSize = 54;
      const gap = 4;
      const groupGap = 8; // extra spacing every 5 icons (Beat / Effect / Melody / Voice)
      const rows = Math.ceil(pictos.length / cols);

      const totalW = cols * iconSize + (cols - 1) * gap + 3 * groupGap;
      const totalH = rows * iconSize + (rows - 1) * gap;

      box.style.width = `${totalW}px`;
      box.style.height = `${totalH}px`;
      box.style.left = '50%';
      box.style.top = '6px';
      box.style.marginLeft = `${-Math.round(totalW / 2)}px`;
      box.style.transformOrigin = 'top center';
      box.style.transform = 'scale(0.78)';

      pictos.forEach((el, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const groupIdx = Math.floor(col / 5);
        const x = col * (iconSize + gap) + groupIdx * groupGap;
        const y = row * (iconSize + gap);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      });

      if (typeof window.resetStagePosition === 'function') {
        try {
          window.resetStagePosition();
        } catch (_) {
          // Ignore if stage not ready yet
        }
      }
    }

    const pictoObserver = new MutationObserver(() => {
      const box = document.getElementById('box-picto');
      if (box && box.querySelectorAll('.picto').length > 20) {
        layoutApkPictos(false);
      }
    });
    pictoObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', () => setTimeout(() => layoutApkPictos(true), 80));
    setTimeout(() => layoutApkPictos(true), 400);
    setTimeout(() => layoutApkPictos(true), 1200);

    // Replay seek fix: the APK engine's moveControlHead() maps pageX to a loop index with
    // `(pageX - $incredibox.offsetLeft) / (screenW - 2 * offsetLeft)`, i.e. unscaled layout
    // coordinates. With our body `scale(apkScale)` (origin center) the visible stage starts
    // (1 - scale) / 2 of the width further right, so at 90% the leftmost point seeks to 5%
    // (e.g. 1:19 of a 26:14 mix) and the end is unreachable. Use the on-screen rect instead.
    function patchReplaySeek() {
      const orig = window.moveControlHead;
      if (typeof orig !== 'function' || orig.__modloaderPatched) return typeof orig === 'function';
      const patched = function (e) {
        try {
          const bar = window.readingBar;
          const stage = window.$incredibox && window.$incredibox[0];
          let p = e;
          if (p && typeof p.type === 'string' && p.type.indexOf('touch') !== -1) p = p.originalEvent || p;
          if (p && p.targetTouches && p.targetTouches.length) p = p.targetTouches[0];
          const rect = stage && stage.getBoundingClientRect();
          if (!bar || !rect || !(rect.width > 0) || !(bar.maxLoop > 0) || typeof p.clientX !== 'number') {
            return orig.apply(this, arguments);
          }
          let i = Math.floor((bar.maxLoop * (p.clientX - rect.left)) / rect.width);
          i = Math.max(0, Math.min(bar.maxLoop - 1, i));
          bar.seek(i);
        } catch (err) {
          console.error('[ModLoader] replay seek patch failed, using original:', err);
          return orig.apply(this, arguments);
        }
      };
      patched.__modloaderPatched = true;
      window.moveControlHead = patched;
      return true;
    }
    if (!patchReplaySeek()) window.addEventListener('load', patchReplaySeek, { once: true });

    // Home "back to PC" button. APK (Android) engines have no incredimod buttons
    // (#home-bt-modlist / #home-bt-modcredit exist only in the PC app.html), so the
    // top-left corner of the APK home is empty. Put a round button there, sized and
    // themed like the engine's own #home-bt-info (.bt in #home -> var(--col1) colours),
    // and show it whenever the engine animates #home-bt-info in.
    function addApkHomeBackButton() {
      const home = document.getElementById('home');
      if (!home || document.getElementById('ml-home-bt-backpc')) return;

      const style = document.createElement('style');
      style.id = 'ml-home-bt-backpc-css';
      style.textContent = `
        #home .bt#ml-home-bt-backpc { top: 44px; left: 44px; width: 44px; height: 44px; min-width: 0; min-height: 0; }
        #home .bt#ml-home-bt-backpc .bck { line-height: 0; }
        #home .bt#ml-home-bt-backpc.animate { animation: ml-home-bt-in .3s cubic-bezier(.175,.885,.32,1.275) 0s forwards; }
        @keyframes ml-home-bt-in {
          0% { opacity: 0; transform: scale(.5); }
          to { opacity: 1; transform: scale(1); cursor: pointer; }
        }
        body.mobile #home .bt#ml-home-bt-backpc { width: 60px; height: 60px; }
        body.ultrawide #home .bt#ml-home-bt-backpc { margin-left: 50px; }
        body.miniPlayer #home #ml-home-bt-backpc, .expo #ml-home-bt-backpc { display: none; }
      `;
      document.head.appendChild(style);

      const btn = document.createElement('div');
      btn.id = 'ml-home-bt-backpc';
      btn.className = 'bt';
      btn.title = 'Back to PC Incredibox (mod list)';
      btn.innerHTML =
        '<div class="bck"><svg class="icn-svg" viewBox="0 0 32 32">' +
        '<path d="M9 16 15.5 9.5 17.4 11.4 14.1 14.7H23V17.3H14.1L17.4 20.6 15.5 22.5Z"></path>' +
        '</svg></div><div class="hitzone"></div>';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        api.backToPc();
      });
      home.appendChild(btn);

      const info = document.getElementById('home-bt-info');
      if (!info) {
        btn.classList.add('animate');
        return;
      }
      const sync = () => btn.classList.toggle('animate', info.classList.contains('animate'));
      sync();
      new MutationObserver(sync).observe(info, { attributes: true, attributeFilter: ['class'] });
    }
    if (document.getElementById('home')) addApkHomeBackButton();
    else window.addEventListener('DOMContentLoaded', addApkHomeBackButton, { once: true });
  } else {
    // PC mode: multi-row 20-column picto grid for >20-character mods (e.g. 100 chars = 5x20).
    // Standard <=20-character mods are left untouched.
    if (!document.getElementById('incredibox-modloader-100p-css')) {
      const style = document.createElement('style');
      style.id = 'incredibox-modloader-100p-css';
      style.textContent = `
        html.ml-100p-mode {
          --box-top-height-int: 10 !important;
          --box-bottom-height-int: 50 !important;
          --box-top-height-pct: 10% !important;
          --box-bottom-height-pct: 50% !important;
        }
        #box-bottom #box-picto.ml-grid-picto {
          top: 50% !important;
          transform: translateY(-50%);
          width: auto !important;
        }
        #box-bottom #box-picto.ml-grid-picto .pictoline {
          margin: 0 !important;
          justify-content: center;
        }
      `;
      document.head.appendChild(style);
    }

    window.__mlLayoutPcPictos = function () {
      const pictoBox = document.getElementById('box-picto');
      const boxBottom = document.getElementById('box-bottom');
      if (!pictoBox || !boxBottom) return;

      const pictos = Array.from(pictoBox.querySelectorAll('.picto')).sort(
        (a, b) => (parseInt(a.dataset.pictoNum, 10) || 0) - (parseInt(b.dataset.pictoNum, 10) || 0)
      );

      if (pictos.length <= 20) {
        const hadMode = document.documentElement.classList.contains('ml-100p-mode');
        document.documentElement.classList.remove('ml-100p-mode');
        pictoBox.classList.remove('ml-grid-picto');
        pictoBox.querySelectorAll('.pictoline.ml-extra').forEach((el) => el.remove());
        if (hadMode) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        return;
      }

      const wasMode = document.documentElement.classList.contains('ml-100p-mode');
      document.documentElement.classList.add('ml-100p-mode');
      pictoBox.classList.add('ml-grid-picto');
      if (!wasMode) {
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      }
      const cols = 20;
      const rows = Math.ceil(pictos.length / cols);

      const topLine = pictoBox.querySelector('.pictoline.top');
      const botLine = pictoBox.querySelector('.pictoline.bot');
      if (!topLine || !botLine) return;

      const lines = [topLine, botLine];
      const existingExtras = Array.from(pictoBox.querySelectorAll('.pictoline.ml-extra'));
      for (let r = 2; r < rows; r++) {
        let line = existingExtras[r - 2];
        if (!line) {
          line = document.createElement('div');
          line.className = 'pictoline ml-extra';
          pictoBox.appendChild(line);
        }
        lines.push(line);
      }
      for (let i = Math.max(0, rows - 2); i < existingExtras.length; i++) {
        existingExtras[i].remove();
      }

      pictos.forEach((el, idx) => {
        const row = Math.floor(idx / cols);
        const target = lines[row];
        if (target && el.parentNode !== target) {
          target.appendChild(el);
        }
      });

      const availW = Math.max(320, boxBottom.clientWidth - 24);
      const availH = Math.max(120, boxBottom.clientHeight - 12);
      const gap = Math.max(2, Math.min(6, Math.floor(availH * 0.015)));
      const groupGap = gap * 2 + 4;
      const sizeByH = Math.floor((availH - (rows - 1) * gap) / rows);
      const sizeByW = Math.floor((availW - (cols - 1) * gap - 3 * groupGap) / cols);
      const iconSize = Math.max(22, Math.min(68, sizeByH, sizeByW));

      lines.forEach((line, r) => {
        line.style.marginBottom = r < rows - 1 ? `${gap}px` : '0px';
      });

      pictos.forEach((el, idx) => {
        const col = idx % cols;
        el.style.width = `${iconSize}px`;
        el.style.height = `${iconSize}px`;
        el.style.margin = '0px';
        const isRowEnd = col === cols - 1 || idx === pictos.length - 1;
        if (isRowEnd) {
          el.style.marginRight = '0px';
        } else if (col === 4 || col === 9 || col === 14) {
          el.style.marginRight = `${gap + groupGap}px`;
        } else {
          el.style.marginRight = `${gap}px`;
        }
      });
    };

    // In case renderer.js was injected after iB() already ran
    if (document.querySelectorAll('#box-picto .picto').length > 20) {
      window.__mlLayoutPcPictos();
    }
  }

  // Inject CSS & JS for each discovered JS mod
  for (const mod of init.mods) {
    if (mod.cssCode) {
      const style = document.createElement('style');
      style.dataset.modId = mod.id;
      style.textContent = mod.cssCode;
      document.head.appendChild(style);
    }

    let status = 'loaded';
    let error = null;

    if (mod.rendererCode) {
      try {
        const fn = new Function('ModLoader', 'mod', mod.rendererCode);
        fn(api, {
          id: mod.id,
          name: mod.name,
          version: mod.version,
          author: mod.author,
          description: mod.description,
        });
      } catch (err) {
        status = 'error';
        error = err && err.message ? err.message : String(err);
        console.error(`[ModLoader] Error in mod "${mod.id}":`, err);
      }
    }

    api.mods.push({
      id: mod.id,
      name: mod.name,
      version: mod.version,
      author: mod.author,
      description: mod.description,
      status,
      error,
    });
  }

  // Status badge
  const badge = document.createElement('div');
  badge.id = 'incredibox-modloader-badge';
  badge.textContent = `ModLoader v${api.version} (${api.mods.length} JS, ${api.apkMods.length} APK) [F10]`;
  Object.assign(badge.style, {
    position: 'fixed',
    bottom: '8px',
    left: '8px',
    zIndex: '999999',
    padding: '4px 8px',
    borderRadius: '6px',
    background: 'rgba(15, 15, 20, 0.72)',
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: '11px',
    cursor: 'pointer',
    userSelect: 'none',
    backdropFilter: 'blur(4px)',
    border: '1px solid rgba(255,255,255,0.15)',
  });
  badge.addEventListener('click', () => api.toggleOverlay());
  document.body.appendChild(badge);

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'incredibox-modloader-overlay';
  Object.assign(overlay.style, {
    display: 'none',
    position: 'fixed',
    top: '48px',
    left: '48px',
    width: '390px',
    maxHeight: '75vh',
    overflowY: 'auto',
    zIndex: '999999',
    padding: '14px',
    borderRadius: '10px',
    background: 'rgba(15, 18, 25, 0.94)',
    color: '#f8fafc',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.18)',
  });

  const apkRows = api.apkMods.length
    ? api.apkMods
        .map(
          (m) =>
            `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;margin-top:8px;border-radius:6px;background:rgba(255,255,255,0.08);">
              <div>
                <div style="font-weight:600;">${escapeHtml(m.name)}</div>
                <div style="font-size:11px;opacity:0.75;">${escapeHtml(m.characters)} chars • ${escapeHtml(m.nbpolo)} polos</div>
              </div>
              <button data-apk-id="${escapeHtml(m.id)}"style="padding:5px 12px;border:none;border-radius:6px;background:#22c55e;color:#052e16;font-weight:700;cursor:pointer;">Play</button>
            </div>`
        )
        .join('')
    : '<div style="margin-top:8px;opacity:0.7;">No APK mods in ApkMods/</div>';

  const jsRows = api.mods.length
    ? api.mods
        .map(
          (m) =>
            `<div style="padding:8px;margin-top:8px;border-radius:6px;background:rgba(255,255,255,0.06);">
              <div style="font-weight:600;">${escapeHtml(m.name)} <span style="opacity:0.7;font-weight:400;">v${escapeHtml(m.version)}</span></div>
              <div style="font-size:11px;opacity:0.75;">by ${escapeHtml(m.author)} • ${escapeHtml(m.status)}${m.error ? `: ${escapeHtml(m.error)}` : ''}</div>
              ${m.description ? `<div style="font-size:12px;margin-top:4px;opacity:0.9;">${escapeHtml(m.description)}</div>` : ''}
            </div>`
        )
        .join('')
    : '<div style="margin-top:8px;opacity:0.7;">No JS mods in Mods/</div>';

  overlay.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <strong>Incredibox ModLoader v${escapeHtml(api.version)}</strong>
      <span style="font-size:11px;opacity:0.7;">F10: Toggle | F12: DevTools</span>
    </div>
    ${
      api.isApkMode
        ? `<div style="margin-top:10px;padding:8px;border-radius:6px;background:rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span style="font-size:12px;">Screen Scale: <strong id="incredibox-apk-scale-val">${Math.round(apkScale * 100)}%</strong></span>
            <div style="display:flex;gap:4px;">
              <button id="incredibox-scale-down" style="padding:3px 9px;border:none;border-radius:4px;background:#334155;color:#fff;cursor:pointer;">-</button>
              <button id="incredibox-scale-up" style="padding:3px 9px;border:none;border-radius:4px;background:#334155;color:#fff;cursor:pointer;">+</button>
              <button id="incredibox-scale-reset" style="padding:3px 9px;border:none;border-radius:4px;background:#334155;color:#fff;cursor:pointer;">90%</button>
            </div>
          </div>
          <button id="incredibox-back-pc-btn" style="width:100%;margin-top:8px;padding:7px;border:none;border-radius:6px;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer;">Back to PC Incredibox</button>`
        : ''
    }
    <div style="margin-top:12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.7;">APK Mods (Full 100p / Custom Engine)</div>
    ${apkRows}
    <div style="margin-top:14px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.7;">JS Mods</div>
    ${jsRows}
  `;

  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-apk-id]');
    if (btn) {
      api.launchApkMod(btn.dataset.apkId);
      return;
    }
    if (e.target && e.target.id === 'incredibox-back-pc-btn') {
      api.backToPc();
    } else if (e.target && e.target.id === 'incredibox-scale-down') {
      applyApkScale(Math.max(0.6, apkScale - 0.05));
    } else if (e.target && e.target.id === 'incredibox-scale-up') {
      applyApkScale(Math.min(1.0, apkScale + 0.05));
    } else if (e.target && e.target.id === 'incredibox-scale-reset') {
      applyApkScale(0.9);
    }
  });

  document.body.appendChild(overlay);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F10') {
      api.toggleOverlay();
    }
  });
})();
