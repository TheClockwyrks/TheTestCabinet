// Automated validation for the Ice band item `speeds`.
//
// The base lane speeds sit in a slow range, and each level speeds them up (about
// 1.06x per level). The lane speeds are read at level 1, at level 2, and at the final
// level, and the per-lane ratios confirmed. See validation/_helpers.mjs.
//
// A SPEED CANNOT BE PHOTOGRAPHED. This item used to capture a still of the level-2
// board, which shows a reviewer some traffic and nothing whatever about how fast it is
// moving — the one thing the item is about. The clip now runs the band at level 1,
// switches to the last level, and runs it again, so the two speeds are seen back to
// back and the scaling is something a person can judge. The second half is the FINAL
// level rather than the next one because that is where the rule has compounded into a
// difference the eye can see: `1.06^7` is about 1.5x, where a single level's `1.06` is
// not a change anyone can spot.
//
// The assertions follow the same pairs. The adjacent step (level 1 to 2) is the rule
// as specs/hazards.md words it; the long step (level 1 to the last level) is that same
// rule compounded, which is what catches a build that scales once and then stops, or
// that speeds up on some levels and not others. Both are read from the lanes the build
// itself reports after it rebuilds each level.

import { actPose, startCrossing } from "../_helpers.mjs";

// The final level (specs/gameplay.md: a run is 8 levels), and the per-level factor.
const LAST_LEVEL = 8;
const PER_LEVEL = 1.06;

// How long each level is filmed. At level 1 the slowest lane covers about five tiles
// in this span, so the pace is established before the level changes under it.
const RUN_TICKS = 300; // 2.5 s

export default function item() {
  // The per-lane speeds at each level. All three are settled the moment the level is
  // built, so all three reads are instant and belong in `arrange`.
  let l1;
  let l2;
  let lLast;

  return {
    id: "ice.speeds",

    // Read the three levels' lane speeds, then leave the board back at level 1, which
    // is where the clip starts. Every step is a control op, so `arrange` stays instant.
    async arrange(api) {
      await startCrossing(api);
      l1 = (await api.snapshot()).lanes.ice.map((l) => l.speed);
      await api.call("setLevel", 2);
      l2 = (await api.snapshot()).lanes.ice.map((l) => l.speed);
      await api.call("setLevel", LAST_LEVEL);
      lLast = (await api.snapshot()).lanes.ice.map((l) => l.speed);
      await api.call("setLevel", 1);
    },

    // Level 1's traffic, then the last level's, back to back on the same board.
    //
    // The level change goes through `actPose`, which hands the clock back after it: a
    // build that switches itself to manual stepping when it is re-posed would otherwise
    // film the whole second half as a frozen board — the half this item exists to show
    // running (see `actPose`).
    async act(api) {
      await api.advance(RUN_TICKS);
      await actPose(api, "setLevel", LAST_LEVEL);
      await api.advance(RUN_TICKS);
    },

    async assert(api, check) {
      for (let i = 0; i < l1.length; i += 1) {
        check.expectGe(
          `level-1 ice lane ${i} speed is in the slow range`,
          l1[i],
          1.4,
        );
        check.expectLe(
          `level-1 ice lane ${i} speed is in the slow range`,
          l1[i],
          2.6,
        );
      }
      for (let i = 0; i < l2.length; i += 1) {
        check.expectClose(
          `ice lane ${i} speeds up ~1.06x at level 2`,
          l2[i] / l1[i],
          PER_LEVEL,
          0.01,
        );
      }
      // The same rule, compounded across the whole run: seven levels of `1.06`.
      const total = PER_LEVEL ** (LAST_LEVEL - 1);
      for (let i = 0; i < lLast.length; i += 1) {
        check.expectClose(
          `ice lane ${i} has compounded to ~${total.toFixed(2)}x by level ${LAST_LEVEL}`,
          lLast[i] / l1[i],
          total,
          0.02,
        );
      }
    },
  };
}
