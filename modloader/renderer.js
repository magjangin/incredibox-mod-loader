(() => {
  if (window.IncrediboxModLoader) return;

  const init = window.__INCREDIBOX_MODLOADER_INIT__ || {
    version: '0.2.0',
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
