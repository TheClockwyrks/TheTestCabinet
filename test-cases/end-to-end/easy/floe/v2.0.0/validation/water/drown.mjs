// Automated validation for the Water band item `drown`.
//
// Standing on a water tile with no floe under it is death. A water lane is cleared
// to open water and the critter is placed on it; the footing reads "water" before
// the step, and the real simulation drowns it on the next step. See
// validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The footing before any time passes (read instantly in `arrange`), and the sweep
  // that waited for the drowning.
  let footing;
  let r;

  return {
    id: "water.drown",

    // Pose the drowning: a water lane cleared to open water with the critter standing
    // on it, and three lives so the loss reads as a decrement.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setLane", 5, { cols: [] }); // open water, no floe
      await api.call("placeCritter", 20, 5);
      footing = (await api.snapshot()).critter.footing;
    },

    // The drowning itself — what is checked, and the clip.
    async act(api) {
      r = await api.until((s) => s.phase === "dying", { max: 120 }); // 1 s
    },

    async assert(api, check) {
      check.expectEq("footing over open water reads 'water'", footing, "water");
      check.expectOk("standing on open water drowns the critter", r.hit);
      check.expectEq("a life is lost to drowning", r.snap.lives, 2);
    },
  };
}
