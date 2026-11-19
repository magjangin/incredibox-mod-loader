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
# everything in one go: extract, draft config.js (if missing), build every phase, install
node convert.js "C:\Users\me\Downloads\project.sb3" --work H:\source\incredibox-work\my-mod --install
# after editing config.js: rebuild without re-extracting
node convert.js --work H:\source\incredibox-work\my-mod --install
```
`convert.js` runs art and audio in parallel for each phase (`--phase <n>` builds one phase, `--config <file>` uses another config). The single steps still work:
```powershell
node prepare.js "C:\Users\me\Downloads\project.sb3" --work H:\source\incredibox-work\my-mod
node build-art.js   --work H:\source\incredibox-work\my-mod --phase 1
node build-audio.js --work H:\source\incredibox-work\my-mod --phase 1
node build-pack.js  --work H:\source\incredibox-work\my-mod --phase 1 --install
```
Close the game before running `--install`. The game rewrites `localmods.json`, so an install made while it is running would be lost. `--install` therefore refuses while `Incredibox*` is running (`--force` overrides). A backup `localmods.json.bak-<time>` is written each time, and the newest 5 are kept.

`prepare.js` drafts `config.js` from the project (`autoconfig.js`): the tempo comes from the saved `Delay`, the slot spacing and height from the `Polo N` sprites, the backdrop and cover from the current costumes, and the slugs from the sprite names. Lines marked `TODO` (author, source, phase-2 tempo) need a look. An existing `config.js` is kept.

| Script | Purpose |
| --- | --- |
| `convert.js` | Whole pipeline in one command (prepare → art ∥ audio → pack, per phase) with timings |
| `prepare.js` | Extracts the sb3 into `<work>/src`, lists the sprites, and drafts `config.js` (`autoconfig.js`) |
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
- `characters[i]`: `slug` (file name), optional `idle` (placed-but-silent costume; default `idle`, then `0`, then the first costume) and optional `dy` (LD px, + moves that character down, e.g. a tall hood clipped at the top). With `framing.fitTop: true`, characters without `dy` are moved down just enough that no pose leaves the top of the frame.
- `platform`: where the original was made, shown in the credits (default `Cocrea`).

- `framing.slotUnits` (scratch mode): the x distance between the `Polo N` sprites (64 in Interbox). The scale then comes from the game's own layout (slots 139.7 LD px apart, sheets drawn at 0.986), so characters keep the original size relative to the slot spacing (k = 2.213 for 64). The older fixed `k: 164 / 65` (Sprunke Kusoshi) draws one slot width per sheet width, which is about 16% too large.
- `background: { mode: 'stage', slotY }`: draws the backdrop in stage coordinates so that it lines up with the characters (`slotY` = stage y of the polo slots). Without it the backdrop image is scaled to cover the frame, which crops or pads backdrops that are larger than the stage. Remember that `modName` (+ phase label) sets the versionId, so do not rename an installed mod.

Format details: see "PC Incredimod Format" in the repository's `AGENTS.md`.
