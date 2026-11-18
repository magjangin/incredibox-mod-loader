# Incredibox ModLoader

## 1. Target Game & Version
- **Game:** Incredibox (Steam PC, v1.2.9)
- **Install Path:** `H:\steam\steamapps\common\Incredibox\Incredibox_steam.exe`
- **Modded Runtime Path:** `H:\steam\steamapps\common\Incredibox\Modded\`
- **Runtime:** Electron (`electron-builder` NSIS portable wrapper containing `$PLUGINSDIR\app-64.7z`, which holds `Incredibox.exe` + `resources\app.asar`)
- **Electron Fuses:** `EnableEmbeddedAsarIntegrityValidation=disabled`, `OnlyLoadAppFromAsar=disabled`, `EnableNodeOptionsEnvironmentVariable=enabled`, `EnableNodeCliInspectArguments=enabled`, `RunAsNode=enabled`

## 2. Design & Rationale
- **Bootstrap Approach (Method A):** Unpacks `app-64.7z` once into `Modded\` and unpacks `resources\app.asar` (985 files) to `resources\app\` (renaming `app.asar` to `app.asar.bak`). This avoids 204MB self-extraction on every launch and allows direct modification without ASAR repacking.
- **Entry Hook & Steam Bypass:** `resources\app\package.json` `"main"` is changed from `src/elec-index.js` to `modloader/main.js`, which preserves `console` methods before `src/elec-index.js` obfuscation overwrites them, sets `PORTABLE_EXECUTABLE_DIR` and `--arg=arp` (`btoa(electron.vars.arg) === "YXJw"` required by `script.min.js`), scans `Mods/` and `ApkMods/` next to `Incredibox.exe`, attaches `BrowserWindow` hooks (`F12` / `Ctrl+Shift+I` DevTools + `dom-ready` renderer injection + `app.html?v=<versionId>` auto-redirect to unpacked APK mods), and then `require('../src/elec-index.js')`.
- **APK Mod Playback (100-char / 10-polo):** PC Incredibox v1.2.9 hardcodes 20 icons and 7 polos in `script.min.js`. `unpack-apk-mod.js` extracts `assets/www/` (neutralizing `cordova.js` so `DOMContentLoaded` runs on desktop) into `Modded\ApkMods\<ModName>\`. `modloader/renderer.js` provides `F10` launch/return controls, 90% default screen scaling, and a 20×5 centered picto grid with 5-icon group gaps (`layoutApkPictos`).

## 3. Key Files
- `modloader/main.js` — Main-process bootstrap, `Mods/` scanner, logger (`Mods/modloader.log`), DevTools shortcut, and renderer injector.
- `modloader/renderer.js` — Renderer `window.IncrediboxModLoader` API, CSS/JS mod executor, bottom-left badge, and `F10` mod list overlay.
- `scripts/extract-asar.js` — Zero-dependency Node.js ASAR extractor.
- `scripts/setup-game.ps1` — Automated extractor/installer using Bandizip (`bz.exe`) + Node.js. `-GameDir` auto-detects via `HKCU\Software\Valve\Steam\SteamPath` + `steamapps\libraryfolders.vdf`; `-TargetDir` defaults to `<GameDir>\Modded`; `-Bandizip` defaults to `$env:BANDIZIP` > Program Files > PATH.
- `scripts/lib/common.js` — Shared `stableVersionId` / `parseAppJs` / `findBandizip` / `findGameDir` / `findModdedDir` (env overrides: `BANDIZIP`, `INCREDIBOX_DIR`). **`stableVersionId` must never change**: existing `apkmod.json` `versionId`s (e.g. `Armed` = 9533019) and imported `incredimods/<versionId>.json` depend on it for the `app.html?v=` redirect.
- `scripts/import-apk.js` — Converts Android Incredibox mod APKs (`assets/www/asset-v*`) into PC `incredimods/<versionId>.json` + `localmods.json` entries under `%APPDATA%\Incredibox\incredimods\`.
- `scripts/unpack-apk-mod.js` — Extracts full `assets/www/` from Android mod APKs into `Modded\ApkMods\<ModName>\` for 100-character / custom-engine playback via the ModLoader `F10` overlay.
- `mods-example/hello-mod/` — Sample mod manifest (`mod.json`) and `renderer.js`.

## 3.1 Conventions / Gotchas
- **Overlay HTML:** all mod / APK metadata (name, author, description, error, id) goes through `escapeHtml` in `modloader/renderer.js` before `innerHTML`. APK `app.js` names are third-party text.
- **Logging:** first log write per launch renames `Mods/modloader.log` → `Mods/modloader.prev.log` (keeps exactly one previous session).
- **`unpack-apk-mod.js` side effect:** rewrites `this.recmaxloop = N` → `999` in every `asset-v*/app.js` (recording limit) and blanks `cordova.js`.
- **Line endings:** files are LF in the working tree; git (autocrlf) warns about CRLF — harmless. Compare deployed vs repo with `diff --strip-trailing-cr`.
- **Quick redeploy of loader only:** copy `modloader\*.js` into `Modded\resources\app\modloader\` (game must be restarted). Full `setup-game.ps1` wipes and re-extracts `resources\app`.

## 3.2 Verification Status (2026-11-18)
- Escape fix: verified offline (VM stub DOM: old renderer leaked raw `<b>/<img>/<script>`, new renderer escapes all). Log rotation: verified with stubbed `electron` over 3 simulated launches. Steam/Bandizip detection: verified on this PC (`h:\steam\...\Incredibox`, `C:\Program Files\Bandizip\bz.exe`).
- **In-game verified (2026-11-18, v1.2.9):** launched `Modded\Incredibox.exe --remote-debugging-port=9333` and inspected via CDP `Runtime.evaluate`: injection + badge `(2 JS, 1 APK)`; a temp mod with `<b id="xss-probe">`/`<img onerror>` metadata rendered as literal text (no element created, handler never fired); `modloader.prev.log` created on launch; `launchApkMod("Armed")` → `ApkMods/Armed/www/app.html?v=1`, `isApkMode=true`, 100 `.picto`; `backToPc()` returns to `src/index.html`; 0 ERROR lines.
- **Test technique:** Electron honours `--remote-debugging-port=<port>`; `http://127.0.0.1:<port>/json/list` → page `webSocketDebuggerUrl`, then Node 22+ global `WebSocket` sends `Runtime.evaluate` / `Page.captureScreenshot`. No extra deps needed.

## 4. Build / Deploy Command
```powershell
powershell -ExecutionPolicy Bypass -File "h:\source\repos\incredibox\scripts\setup-game.ps1"
```
Launch: `H:\steam\steamapps\common\Incredibox\Modded\Incredibox.exe`
