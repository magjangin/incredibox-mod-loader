// Mod-specific settings for "Interbox V1: Subliminal" (Scratch project saved with the Gandi IDE).
// Original creator: Expensive_Chb (told by the user 2026-11-19; not recorded in the .sb3 itself).
module.exports = {
  modName: 'Interbox V1: Subliminal',
  author: 'Expensive_Chb',
  platform: 'Scratch / Gandi IDE',
  source: 'https://scratch.mit.edu/users/Expensive_Chb/',
  coverCostume: 'Preview3',
  // Characters "go to Polo N" (slots 64 stage units apart, sprite size 70) and share the polo's
  // rotation center, so one rotation-center line is used for everyone.
  // slotUnits: Polo N sprites are 64 stage units apart -> k from the game's slot spacing (2.213)
  framing: { mode: 'scratch', slotUnits: 64, charY: 253, panelY: 253, panelTarget: 'Polo 1' },
  // backdrop drawn in stage coordinates; slotY = stage y of the polos after "Go up" (-100 + 5*23.1 - 9)
  background: { mode: 'stage', slotY: 6 },
  panelCostume: {},
  phases: {
    // Stage: Delay = 60 / 130 * 16 = 7.3846 s per loop (no horror phase in this project)
    1: { label: '', loopSec: 7.385, bpm: 130, framesPerLoop: 179, backdrop: '1' },
  },
  // index = icon number - 1 (sprite order in the project). Idle costume = "0" (auto),
  // Effect 5 has no "0" and uses its first costume "GROWL 1" (auto).
  characters: [
    { slug: 'beat1' }, { slug: 'beat2' }, { slug: 'beat3' }, { slug: 'beat4' }, { slug: 'beat5' },
    { slug: 'effect1' }, { slug: 'effect2' }, { slug: 'effect3', dy: 18 }, { slug: 'effect4' }, { slug: 'effect5' },
    { slug: 'melody1' }, { slug: 'melody2' }, { slug: 'melody3' }, { slug: 'melody4' }, { slug: 'melody5' },
    { slug: 'voice1' }, { slug: 'voice2' }, { slug: 'voice3' }, { slug: 'voice4' }, { slug: 'voice5' },
  ],
};
