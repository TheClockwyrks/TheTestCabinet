// Automated validation for the Controls item `hop-down`.
//
// From an isolated safe pocket, one real press of the Down arrow hops the critter
// exactly one tile down (its row increases by one). See validation/_helpers.mjs.

import { arrangeHop, actHopOnce, assertHopControl } from "../_helpers.mjs";

export default function item() {
  // What the press did, for `assert` to read.
  let r;

  return {
    id: "controls.hop-down",

    // Pose the safe pocket: every neighbouring tile is solid and hazard-free, so the
    // result reads only the hop the key produced.
    async arrange(api) {
      await arrangeHop(api);
    },

    // The one real press and the hop it drives — both what is checked and the clip.
    async act(api) {
      r = await actHopOnce(api, "ArrowDown");
    },

    async assert(api, check) {
      assertHopControl(check, r, { dcol: 0, drow: 1, who: "Down arrow" });
    },
  };
}
