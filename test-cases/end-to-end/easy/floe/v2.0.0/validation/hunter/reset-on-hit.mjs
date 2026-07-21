// Automated validation for the Hunter item `reset-on-hit`.
//
// A vehicle sliding into the bear resets it (removed from the strait), and it
// re-emerges from the near shore after a delay — not permanently gone, not merely
// staggered. A bear is placed on an ice tile and a plow set sweeping into it; the
// real collision removes it, and once the (advanced) critter is still up top it
// re-emerges. See validation/_helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // Whether the bear was on the strait before the hit (read instantly in `arrange`),
  // and the two sweeps: the removal, then the return.
  let bearBefore;
  let r;
  let r2;

  return {
    id: "hunter.reset-on-hit",

    // Pose the collision minus its moving plow: the critter up top on a floe (so it
    // stays advanced and the hunt stays live), the bear's own lane cleared so nothing
    // but the plow `act` launches can reset it, and the bear parked in that lane.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLane", WATER_TOP, { cols: [20], speed: 0 }); // floe -> the critter has a safe target up top
      await api.call("placeCritter", 20, WATER_TOP);
      await api.call("setLane", 13, { cols: [] }); // clear the bear's lane so only the sweeping plow (below) resets it
      await api.call("setBear", 0, { col: 20, row: 13 });
      bearBefore = (await api.snapshot()).bears[0].present;
    },

    // Launch the plow and let the real collision take the bear off the strait, then
    // wait for it to come back — the reset and the return, which is the whole item
    // and exactly what the clip should show.
    async act(api) {
      await api.call("setLane", 13, { cols: [23], speed: 12, dir: -1 }); // plow sweeping into the bear
      r = await api.until((s) => !s.bears[0].present, { max: 180 }); // 1.5 s
      r2 = await api.until((s) => s.bears[0].present, { max: 180, poll: 6 }); // 1.5 s at 0.05 s
    },

    async assert(api, check) {
      check.expectEq("bear present before the hit", bearBefore, true);
      check.expectOk(
        "a vehicle sweeping into the bear resets it (removed)",
        r.hit,
      );
      check.expectEq(
        "the bear is gone after the hit",
        r.snap.bears[0].present,
        false,
      );
      check.expectOk(
        "the bear re-emerges (the hunt returns, not permanently gone)",
        r2.hit,
      );
    },
  };
}
