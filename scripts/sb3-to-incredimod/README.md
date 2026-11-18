# sb3 → Incredibox incredimod

Converts a **Sprunki-style Scratch project** (`.sb3`; Cocrea / Scratch) into an Incredibox PC incredimod. The result shows up under **IMPORTED** in the game.

> The project's art and sounds belong to its creator. Convert only projects whose creator allows remixing, keep the credit in the config, and keep the work folder **outside** this repository.

## Assumptions about the project
- Sprites 1–20 (right after the Stage) are the 20 characters, in icon order.
- An `Icons` sprite has costumes `NN-a` (normal) and `NN-c` (in use).
- Characters react to the `Loop 1` / `Loop 2` broadcasts. A global `phase` variable picks the normal or horror set.
- The `Preview` sprite holds the cover costume, and the Stage holds the backdrops.

## Requirements
- Node.js 22 or later (uses the global `fetch` and `WebSocket`)
- Microsoft Edge or Google Chrome (renders the SVG costumes headlessly)
- `ffmpeg` with libvorbis on PATH

## Usage
```powershell
node prepare.js "C:\Users\me\Downloads\project.sb3" --work H:\source\incredibox-work\my-mod
# edit H:\source\incredibox-work\my-mod\config.js
node build-art.js   --work H:\source\incredibox-work\my-mod --phase 1
node build-audio.js --work H:\source\incredibox-work\my-mod --phase 1
node build-pack.js  --work H:\source\incredibox-work\my-mod --phase 1 --install
```
Close the game before running `--install`. The game rewrites `localmods.json`, so an install made while it is running can be lost. A backup `localmods.json.bak-<time>` is written each time.

| Script | Purpose |
| --- | --- |
| `prepare.js` | Extracts the sb3 into `<work>/src`, lists the sprites, and creates `config.js` |
| `timeline.js` | Mini Scratch interpreter: runs each character's Loop 1/2 scripts and records costume changes and sounds. `node timeline.js <project.json> [phase]` prints a summary |
| `build-art.js` | Character sheets with frame JSON, icon sheet, background and cover (`--measure-only` prints sizes only) |
| `build-audio.js` | Exact-length A/B loops that reproduce Scratch's overlapping playback |
| `build-pack.js` | Builds the incredimod pack (`<versionId>.json`). `--install` installs it and registers it in `localmods.json` |
| `sb3-print.js` | Prints a sprite's scripts as readable text: `node sb3-print.js <project.json> "<sprite>"` |

## config.js
See [`configs/sprunke-kusoshi.js`](configs/sprunke-kusoshi.js).
- `phases`: `loopSec` comes from the Scratch delay (`floor(60/BPM*16*20)/20`). `framesPerLoop` ≈ `loopSec × 24.2`. Also sets the background.
- `framing`:
  - `scratch` keeps the original composition (slot width 65 stage units → 164 px).
  - `upper` shows the upper body Incredibox-style.
  - `full` shows the full body.
- `panelCostume`: which costume of the empty-slot sprite to use. `{}` keeps the game's default beatboxer.

Format details: see "PC Incredimod Format" in the repository's `AGENTS.md`.
