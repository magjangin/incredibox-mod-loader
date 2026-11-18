// Mod-specific settings for "Sprunke Kusoshi (Sprunk x Mesmerizer)" by treeguy2763 (Cocrea).
module.exports = {
  modName: 'Sprunke Kusoshi',
  author: 'treeguy2763',
  source: 'https://cocrea.world/@treeguy2763/SprunkeKusoshiSprunkxMesmerizerNOTFORKIDSGore',
  coverCostume: 'Preview5',
  // 'full' = whole body fits the 164x380 frame; 'upper' = Incredibox-style: scale x `scale`,
  // idle head top at `headTop` LD px, legs cut off by the frame bottom.
  // 'scratch' = same composition as the Cocrea player: slot width 65 stage units -> 164 LD,
  // character / panel rotation centers fitted to a screenshot of the original.
  framing: { mode: 'scratch', k: 164 / 65, charY: 253, panelY: 298, panelTarget: 'Polo 1' },
  // per phase: which "Polo N" costume becomes the empty-slot polo. Empty = keep the game's default
  // beatboxer (user preference 2026-11-19; the red FOCUS panel was { 1: '0', 2: '13' }).
  panelCostume: {},
  phases: {
    // phase 1: Scratch "Set Delay 200" -> floor(60/200*16*20)/20 = 4.8 s per loop
    1: { label: '', loopSec: 4.8, bpm: 200, framesPerLoop: 116, backdrop: 'backdropcute' },
    // phase 2 (horror): "Set Delay 140" -> 6.85 s per loop
    2: { label: ' (Horror)', loopSec: 6.85, bpm: 140, framesPerLoop: 166, backdrop: 'backdropevil' },
  },
  // index = icon number - 1 (sprite order in the project)
  characters: [
    { slug: 'oren' }, { slug: 'raddy' }, { slug: 'clukr' }, { slug: 'funbot' }, { slug: 'vineria' },
    { slug: 'gray' }, { slug: 'brud' }, { slug: 'garnold' }, { slug: 'owakcx' }, { slug: 'sky' },
    { slug: 'mrsun' }, { slug: 'durple' }, { slug: 'mrtree' }, { slug: 'simon' }, { slug: 'tunner' },
    { slug: 'mrfuncomputer' }, { slug: 'wenda' }, { slug: 'pinki' }, { slug: 'jevin' }, { slug: 'black' },
  ],
};
