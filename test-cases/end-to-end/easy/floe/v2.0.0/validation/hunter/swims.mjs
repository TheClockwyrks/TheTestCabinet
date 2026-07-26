// Automated validation for the Hunter item `swims`.
//
// Over open water the bear swims, and it moves slower swimming than it does on ice.
// A bear is placed on cleared open water (swimming) and then on cleared ice, and
// its per-step displacement toward the same target is compared. See _helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

// Let the bear commit a step, so `swimming` is set from the footing it is actually
// standing on. The old script used 0.08 s, which is 9.6 ticks — not a whole tick, and
// the tick contract throws rather than rounding. This is a settle rather than a
// measured duration (nothing compares it to anything), so it rounds UP to 10 ticks
// (0.0833 s): the bear definitely commits, and rounding down could leave it mid-step.
// Both scenarios use the same value, so the swim/ice comparison stays symmetric.
const COMMIT_TICKS = 10;

// The measured span, identical for both footings so the displacements are comparable.
const MEASURE_TICKS = 18; // 0.15 s

export default function item() {
  // What each footing measured, for `assert` to compare.
  let swimming;
  let swimDisp;
  let onIceSwimming;
  let iceDisp;

  return {
    id: "hunter.swims",

    // Pose the swim: the critter up top on a floe so the bear has a target to move
    // toward, three water rows cleared to open water, and the bear sitting in them.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLane", WATER_TOP, { cols: [20], speed: 0 }); // safe target up top for the critter
      await api.call("placeCritter", 20, WATER_TOP);
      for (const r of [4, 5, 6]) await api.call("setLane", r, { cols: [] }); // open water
      await api.call("setBear", 0, { col: 20, row: 6 });
    },

    // Measure the same pursuit over the same span on each footing: first swimming
    // across open water, then walking on cleared ice. The move between them is
    // control ops only (`setLane` / `setBear`) — no reset, which would freeze the
    // recording. Both footings in one clip is also what makes the difference legible.
    async act(api) {
      await api.advance(COMMIT_TICKS);
      swimming = (await api.snapshot()).bears[0].swimming;
      const yA = (await api.snapshot()).bears[0].y;
      await api.advance(MEASURE_TICKS);
      swimDisp = Math.abs((await api.snapshot()).bears[0].y - yA);

      // Now the same pursuit on ice.
      for (const r of [13, 14, 15]) await api.call("setLane", r, { cols: [] });
      await api.call("setBear", 0, { col: 20, row: 15 });
      await api.advance(COMMIT_TICKS);
      onIceSwimming = (await api.snapshot()).bears[0].swimming;
      const yB = (await api.snapshot()).bears[0].y;
      await api.advance(MEASURE_TICKS);
      iceDisp = Math.abs((await api.snapshot()).bears[0].y - yB);
    },

    async assert(api, check) {
      check.expectEq("the bear over open water is swimming", swimming, true);
      check.expectEq("the bear on ice is not swimming", onIceSwimming, false);
      check.expectLt(
        "swimming is slower than moving on ice",
        swimDisp,
        iceDisp,
      );
    },
  };
}
