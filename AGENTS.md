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
- `scripts/sb3-to-incredimod/` — Converts a Sprunki-style Scratch `.sb3` into a PC incredimod: Scratch timeline interpreter, headless-Edge SVG rendering, ffmpeg A/B loops, and the pack installer.
- `launcher/IncrediboxLauncher.cs` — Steam `Incredibox_steam.exe` replacement that starts `Modded\Incredibox.exe`.
- `mods-example/hello-mod/` — Sample mod manifest (`mod.json`) and `renderer.js`.

## 3.0 Steam Launcher (Incredibox_steam.exe replacement)
- **Why:** users launching from Steam got the vanilla game (same `%APPDATA%\Incredibox\incredimods` list, so imported mods appear but no loader/badge) and could not tell whether mods were applied.
- **How:** `setup-game.ps1` step 6 compiles `launcher/IncrediboxLauncher.cs` with `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` (C# 5 — no `$""` interpolation) and installs it as `<GameDir>\Incredibox_steam.exe`; the real Steam exe is moved to `Incredibox_steam.original.exe`. Launcher starts `Modded\Incredibox.exe` with args passed through, waits for exit (Steam playtime/"Running" state), Shift held → original exe, Modded missing → original + warning.
- **Detection:** launcher is identified by `VersionInfo.ProductName == "Incredibox ModLoader Launcher"`. If `Incredibox_steam.exe` is *not* the launcher (first install, Steam update or verify), setup treats it as the newest original, replaces the `.original.exe` backup and extracts from it; otherwise it extracts from `.original.exe`.
- **Steam appid:** 1545450 (`appmanifest_1545450.acf`, buildid 21134016, `AutoUpdateBehavior 0` = auto-update ON → an update restores the original exe; re-run setup). `-Uninstall` restores the original; `-NoLauncher` skips step 6. Launcher only supports `TargetDir = <GameDir>\Modded`.
- **Verified 2026-11-18:** `steam://rungameid/1545450` → `Incredibox_steam.exe` (launcher, parent steam.exe) → `Modded\Incredibox.exe`, loader injected; closing the game window ends the launcher. `--remote-debugging-port=9333` passed through the launcher reaches Electron.
- **Verified by the user:** pressing ▶ on the *Imported* "Armed" cover (PC incredimod v=9533019) fires `will-navigate` to `src/app.html?v=9533019`, which opens the Armed APK window. `script.min.js` is obfuscated with an obfuscator.io string array (`a4`/`a5`, offset 0x122). To read it, decode the array in a `vm` context; there are no plain `app.html` literals.

## 3.0.1 APK Mod Storage Isolation (2026-11-18 save-loss incident)
- **Incident:** a mix the user saved in the Armed APK engine (`mix-<20-hex>-v1`) vanished. Cause: APK engines were loaded in the PC window on the same `file://` origin, so they shared localStorage with the PC game. The PC `script.min.js` runs `deleteOldLocalMixes()` at startup, which deletes every `mix-`/`fav-` entry whose `link` contains both digits and letters, so it deleted the APK mix (22:12:55, same batch as PC `timer-restore`). The APK engine also overwrote the PC `user-lang` (ko → en-US).
- **Fix (main.js):** APK mods now open in their **own BrowserWindow** with `partition: persist:apkmod-<id>-<sha1-8>` (separate localStorage). PC window is hidden while it is open and shown again on close. Same preload as the PC window (`getLastWebPreferences()`, fallback `src/elec-preload.js`) because APK engines call `_electron.machine.machineIdSync()` on desktop. Navigation rules (`will-navigate`): `app.html?v=<versionId>` or any URL under `ApkMods/<mod>/www/` → open that mod's window; inside an APK window, navigating to `resources/app/src/*` (Back to PC) → close the window.
- **Saves backup:** every APK window dom-ready / 30 s / close → `ApkMods/<mod>/saves/backup-latest.json` (+ `backup-previous.json`) and `backup-archive.json` (union, never removes keys).
- **Restore:** `ApkMods/<mod>/restore/*.json` = `{"key","value"}` is written into that mod's partition if the key is missing, then moved to `restore/done/`. The recovered Armed mix was staged there. The raw recovery also lives at `_save-backup/20261118-2230/recovered-mix-*.json` (gitignored).
- **Recovery technique:** Chromium localStorage = LevelDB at `%APPDATA%\Incredibox\Local Storage\leveldb`. Deleted values can survive in an older `.ldb` table until compaction. Parse the SSTable (footer → index block → snappy data blocks; key = `_file://\0\x01<key>`, value byte 0 = `\x01` latin1 / `\x00` UTF-16LE). Back up the folder **before** launching the game again.
- `unpack-apk-mod.js` now replaces only `www/` and `apkmod.json`; `saves/` and `restore/` are user data and must survive re-unpacking.
- **Known APK engine behaviour (not ours):** `getStatMixOnline` deletes *online* mixes the server does not return; `checkNews` `eval`s server-sent `msg`.
- **Verified:** offline with stubbed Electron (8 checks), then **in game by the user (2026-11-18 23:17)**. Imported Armed ▶ opened the APK window (partition `persist:apkmod-Armed-32caa310`), log showed `Restore …: restored` + `Saves backed up (1 mix/fav)`, and the mix is back in MY MIX.

## 3.0.2 PC Incredimod Format (reverse-engineered from v1.2.9 `script.min.js`, verified in game 2026-11-19)
- **Decoding the game JS:** `script.min.js` uses an obfuscator.io string array (`a4()` array, `a5(i)` = `array[i-0x122]`, rotation IIFE `(a4,0x72700)`). Run those three pieces in a `vm` context, then replace `xx(0x…)` calls with the strings. Built-in version configs are `gb["v1"]…gb["v9"]`.
- **Pack file:** `%APPDATA%\Incredibox\incredimods\<versionId>.json` = `{ "<path>": { "dataURL": "data:…;base64,…" } }`, plus an entry in `localmods.json` (`version, name, crew, modders, date, icon (dataURL), format, size, modio:false`). Paths: `app.json`, `anime/<name>.png` (HD) + `anime/<name>-ld.png` + `anime/<name>.json`, `anime/0_polo.png`/`0_polo-ld.png` (empty-slot beatboxer), `image/game-bck.jpg` (2048×800), `image/game-picto.png`, `image/home-screen.jpg` (2976×1420), `image/icon.jpg`, `image/crew.jpg`, `sound/<ogg|mp3>/<name>_a.<ext>` (+ `_b`).
- **app.json:** `looptime` ms, `bpm`, `totalframe` = frames for **two** loops (~24 fps; e.g. 4800 ms → 232), `animearray[{name,color,uniqsnd}]`. `uniqsnd:false` → engine alternates `<name>_a` / `<name>_b` and the anime JSON has `totalframe` frames (A then B); `uniqsnd:true` → one sound and `totalframe/2` frames.
- **Anime JSON / sheet:** `width` 164, `height` 380 (forced to 380 unless `version` ≥ 1), `headHeight`, optional `gap`. All coordinates are in **LD pixels**; the HD sheet is ×2. Sheet row 0 = [idle full body | body without head (drawn while playing) | black silhouette (mute overlay, alpha 0.7)]. Each `arrayFrame[i].prop = "x,y,dx,dy"` is the source top-left of a `width × headHeight` "head" crop drawn at `(dx,dy)` over the body. For full-body animation, set `headHeight = 380` and make the body cell transparent.
- **Picto sheet:** 20 × 136 px icons (HD 2720×272). Row 0 = normal, row 1 = icon "in use".
- **Polo sprite (`0_polo`, LD 656×480):** base 164×400 at (0,0), overlay silhouette at (164,0) (drawn with alpha, which is why polos look grey), eyelids at x=328 and eyes at x=492 (164×40 rows, `eyesTopY` 97). Geometry comes from `iy.polo` in the game JS.

## 3.0.3 Scratch (.sb3) → Incredimod Converter (Sprunki-style projects)
- **Location:** code is in `scripts/sb3-to-incredimod/` (see its README). Work folders such as `H:\source\incredibox-work\sprunke-kusoshi\` hold `src/` (the extracted `.sb3`), `out/` and `config.js`. Keep them **outside** the repo, because the `.sb3` and generated assets are third-party content. Pipeline: `prepare.js` → `build-art.js` → `build-audio.js` → `build-pack.js --install`, each with `--work <dir>`. `configs/sprunke-kusoshi.js` is the reference config. The repo version was verified against the installed pack: all 68 images and JSON files are byte-identical, and the 40 ogg files decode to identical PCM (Ogg stream serials are random, so the bytes differ). The old `tools/` copy in that work folder is superseded.
- **Assumes:** sprites 1–20 are the characters in icon order, `Icons` has `NN-a` / `NN-c` costumes, characters use `Loop 1` / `Loop 2` broadcasts, and `Preview` holds the cover.
- **First conversion:** "Sprunke Kusoshi (Sprunk x Mesmerizer)" by treeguy2763 (Cocrea, open source `PUBLIC`; the user forked it and downloaded the `.sb3` themselves). Installed as incredimod `9483402`. Phase 1 (200 BPM, 4.8 s loop) only.
- **Timeline:** a mini Scratch interpreter runs each character's `Loop 1` / `Loop 2` broadcast hats at 30 fps (`wait` resumes at frame boundaries, non-warp `repeat` yields one frame per iteration, scripts are cut at `loopSec`). It records costume switches **and `sound_play`**, because the sound choice depends on globals (e.g. `Maj/Min` defaults to `Min` → Mr. Sun plays sounds 5/6, not 1/2). Stage variables seed the globals; `phase` is overridden.
- **Audio:** three cycles of Loop1/Loop2 starts are mixed (a sound that restarts cuts its previous instance, as in Scratch; tails of other sounds overlap into the next loop). The last cycle is split into `_a` / `_b` of exactly `looptime`, encoded as Vorbis.
- **Framing (user-approved 2026-11-19):** `scratch` mode maps the Cocrea slot (65 stage units wide) to 164 LD (`k = 164/65`). The character rotation center is at (82, 253) LD, fitted to a screenshot of the original. The user tried and rejected full body (too small) and Incredibox-style "head at the top" x1.8. They also tried the original red "FOCUS" panel as the empty slot and asked to go back to the **default Incredibox beatboxer** (`panelCostume: {}`).
- **Rendering:** headless Edge (`--headless=new`, CDP over the global `WebSocket`) draws SVG costumes into canvas from data URLs. In Git Bash heredocs `\\x` and `${…}` get mangled, so write such scripts with the Write tool.

## 3.1 Conventions / Gotchas
- **Overlay HTML:** all mod / APK metadata (name, author, description, error, id) goes through `escapeHtml` in `modloader/renderer.js` before `innerHTML`. APK `app.js` names are third-party text.
- **Logging:** first log write per launch renames `Mods/modloader.log` → `Mods/modloader.prev.log` (keeps exactly one previous session).
- **`unpack-apk-mod.js` side effect:** rewrites `this.recmaxloop = N` → `999` in every `asset-v*/app.js` (recording limit) and blanks `cordova.js`.
- **Line endings:** files are LF in the working tree; git (autocrlf) warns about CRLF — harmless. Compare deployed vs repo with `diff --strip-trailing-cr`.
- **Quick redeploy of loader only:** copy `modloader\*.js` into `Modded\resources\app\modloader\` (game must be restarted). Full `setup-game.ps1` wipes and re-extracts `resources\app`.

## 3.2 Verification Status (2026-11-18)
- **Rule (from the user, 2026-11-18): agents must NOT launch, close or click the game for testing.** The user runs in-game tests personally; agents stop at build/deploy/offline tests and hand over a checklist.
- Escape fix: verified offline (VM stub DOM: old renderer leaked raw `<b>/<img>/<script>`, new renderer escapes all). Log rotation: verified with stubbed `electron` over 3 simulated launches. Steam/Bandizip detection: verified on this PC (`h:\steam\...\Incredibox`, `C:\Program Files\Bandizip\bz.exe`).
- **In-game verified (2026-11-18, v1.2.9):** launched `Modded\Incredibox.exe --remote-debugging-port=9333` and inspected via CDP `Runtime.evaluate`: injection + badge `(2 JS, 1 APK)`; a temp mod with `<b id="xss-probe">`/`<img onerror>` metadata rendered as literal text (no element created, handler never fired); `modloader.prev.log` created on launch; `launchApkMod("Armed")` → `ApkMods/Armed/www/app.html?v=1`, `isApkMode=true`, 100 `.picto`; `backToPc()` returns to `src/index.html`; 0 ERROR lines.
- **Test technique:** Electron honours `--remote-debugging-port=<port>`; `http://127.0.0.1:<port>/json/list` → page `webSocketDebuggerUrl`, then Node 22+ global `WebSocket` sends `Runtime.evaluate` / `Page.captureScreenshot`. No extra deps needed.

## 4. Build / Deploy Command
```powershell
powershell -ExecutionPolicy Bypass -File "h:\source\repos\incredibox\scripts\setup-game.ps1"
```
Launch: `H:\steam\steamapps\common\Incredibox\Modded\Incredibox.exe`
