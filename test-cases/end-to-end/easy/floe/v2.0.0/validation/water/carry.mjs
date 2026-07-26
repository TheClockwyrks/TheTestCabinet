// Automated validation for the Water band item `carry`.
//
// A floe carries the critter sideways at the lane velocity while it stands on it,
// and it survives there. A stationary-kind floe is set drifting under the critter's
// tile, and the real drift moves the critter with it, which the snapshot reads
// back. See validation/_helpers.mjs.

import { startCrossing, TICK_HZ, TILE } from "../_helpers.mjs";

// The measured span. `advance` counts TICKS, but a lane's `speed` is in tiles per
// SECOND, so the expected displacement needs the same span in seconds: 60 ticks at
// 120 Hz is exactly 0.5 s, so both forms are exact and the comparison stays tight.
const DT_TICKS = 60;
const DT = DT_TICKS / TICK_HZ; // 0.5 s

export default function item() {
  // The footing and starting x, both read instantly in `arrange` before the drift, and
  // the state at the end of the measured span.
  let footing;
  let bx;
  let after;

  return {
    id: "water.carry",

    // Pose the ride: one floe under the critter's column, drifting right at a known
    // lane speed, with the critter standing on it.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLane", 5, { cols: [20], speed: 3, dir: 1 }); // floe under col 20 drifting right
      await api.call("placeCritter", 20, 5);
      const s = await api.snapshot();
      footing = s.critter.footing;
      bx = s.critter.x;
    },

    // The validate pass advances the sim by exactly this much (no stray wall-clock
    // frames), so the carry equals the lane velocity times dt to within float
    // rounding. The critter riding the drifting floe is also the clip.
    async act(api) {
      await api.advance(DT_TICKS);
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("footing on a floe reads 'floe'", footing, "floe");
      check.expectClose(
        "the floe carries the critter by the lane velocity",
        after.critter.x - bx,
        3 * TILE * DT,
        1e-3,
      );
      check.expectNe("the critter survives on the floe", after.phase, "dying");
      check.expectEq("still crossing", after.screen, "playing");
    },
  };
}
