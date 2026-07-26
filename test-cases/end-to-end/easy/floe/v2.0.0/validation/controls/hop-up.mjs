// Automated validation for the Controls item `hop-up`.
//
// From an isolated safe pocket, one real press of the Up arrow hops the critter
// exactly one tile up (its row decreases by one) through the game's own play code,
// which the snapshot reads back. See validation/_helpers.mjs.

import { arrangeHop, actHopOnce, assertHopControl } from "../_helpers.mjs";

export default function item() {
  // What the press did, for `assert` to read.
  let r;

  return {
    id: "controls.hop-up",

    // Pose the safe pocket: every neighbouring tile is solid and hazard-free, so the
    // result reads only the hop the key produced.
    async arrange(api) {
      await arrangeHop(api);
    },

    // The one real press and the hop it drives — both what is checked and the clip.
    async act(api) {
      r = await actHopOnce(api, "ArrowUp");
    },

    async assert(api, check) {
      assertHopControl(check, r, { dcol: 0, drow: -1, who: "Up arrow" });
    },
  };
}
