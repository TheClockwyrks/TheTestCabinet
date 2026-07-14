// Holdfast — the playable start this build ships (specs/mode-base.md).
//
// THE START IS ISOLATED TO THIS CONFIG: the crew size, the modest opening stock, and the
// deterministic world-gen seed for the reference map. Everything else — the tile world,
// the settlers and their needs/mood/skills, the gather/build/cook/farm economy, the
// threat director and ranged combat, the day/night cycle, and the survival flow — is the
// common set of specs, used unmodified (specs/mode-base.md "no overrides").

import type { StartConfig } from "./constants";

// The main-menu entry that opens this start (shown before HOW TO PLAY, specs/mode-base.md).
export const MENU_ENTRY = "NEW COLONY";

// The base "New Colony" frontier start: 3 settlers on open ground at a central landing
// site, WOOD 120 / ORE 0 / CROPS 0 / MEALS 8 on hand, tree stands and ore veins in reach.
export const MODE: StartConfig = {
  crew: 3,
  stock: { wood: 120, ore: 0, crops: 0, meals: 8 },
  mapSeed: 0x484f4c44, // "HOLD" — a fixed seed so the reference map is reproducible run to run
};
