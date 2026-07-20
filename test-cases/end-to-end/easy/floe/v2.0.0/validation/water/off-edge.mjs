// Automated validation for the Water band item `off-edge`.
//
// Being carried by a floe off the side edge of the strait is death. A floe near
// the right edge is set drifting outward with the critter aboard; the real drift
// sweeps it off the edge, and the snapshot reads the death back. See
// validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The footing before the drift (read instantly in `arrange`), and the sweep that
  // waited for the death.
  let footing;
  let r;

  return {
    id: "water.off-edge",

    // Pose the ride off the edge: a floe close to the right boundary drifting outward,
    // with the critter aboard and three lives so the loss reads as a decrement.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setLane", 5, { cols: [38], speed: 6, dir: 1 }); // floe near the right edge, drifting out
      await api.call("placeCritter", 38, 5);
      footing = (await api.snapshot()).critter.footing;
    },

    // The floe carrying the critter off the edge — what is checked, and the clip.
    async act(api) {
      r = await api.until((s) => s.phase === "dying", { max: 240 }); // 2 s
    },

    async assert(api, check) {
      check.expectEq("riding a floe at the edge", footing, "floe");
      check.expectOk("riding a floe off the side edge is death", r.hit);
      check.expectEq("a life is lost going off the edge", r.snap.lives, 2);
    },
  };
}
