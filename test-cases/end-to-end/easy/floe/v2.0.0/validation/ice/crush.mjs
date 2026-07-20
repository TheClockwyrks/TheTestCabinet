// Automated validation for the Ice band item `crush`.
//
// A vehicle that slides INTO the critter's own tile crushes it — a life is lost.
// The critter is stood on an ice tile and a plow is set sliding into it from the
// next tile; the real motion and collision decide the crush, which the snapshot
// reads back. See validation/_helpers.mjs.

import { startCrossing, ICE_TOP } from "../_helpers.mjs";

export default function item() {
  // The sweep that waited for the crush.
  let r;

  return {
    id: "ice.crush",

    // Pose the crush: the critter on an ice tile with a plow one tile to its right
    // sweeping left into it, and a full three lives so the loss reads as a decrement.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setLane", ICE_TOP, { cols: [21], speed: 8, dir: -1 }); // plow sweeping left into the critter
      await api.call("placeCritter", 20, ICE_TOP);
    },

    // The plow sliding into the critter and the crush resolving — what is checked and
    // what the clip shows. (The old clip ran the plow slower, at speed 6; the
    // assertions drove speed 8, so that is what is filmed.)
    async act(api) {
      r = await api.until((s) => s.phase === "dying", { max: 180 }); // 1.5 s
    },

    async assert(api, check) {
      check.expectOk(
        "a vehicle sliding into the critter's tile crushes it",
        r.hit,
      );
      check.expectEq(
        "the phase is dying after the crush",
        r.snap.phase,
        "dying",
      );
      check.expectEq("a life is lost to the crush", r.snap.lives, 2);
    },
  };
}
