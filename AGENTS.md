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
- `scripts/setup-game.ps1` — Automated extractor/installer using Bandizip (`bz.exe`) + Node.js.
- `scripts/import-apk.js` — Converts Android Incredibox mod APKs (`assets/www/asset-v*`) into PC `incredimods/<versionId>.json` + `localmods.json` entries under `%APPDATA%\Incredibox\incredimods\`.
- `scripts/unpack-apk-mod.js` — Extracts full `assets/www/` from Android mod APKs into `Modded\ApkMods\<ModName>\` for 100-character / custom-engine playback via the ModLoader `F10` overlay.
- `mods-example/hello-mod/` — Sample mod manifest (`mod.json`) and `renderer.js`.

## 4. Build / Deploy Command
```powershell
powershell -ExecutionPolicy Bypass -File "h:\source\repos\incredibox\scripts\setup-game.ps1"
```
Launch: `H:\steam\steamapps\common\Incredibox\Modded\Incredibox.exe`
