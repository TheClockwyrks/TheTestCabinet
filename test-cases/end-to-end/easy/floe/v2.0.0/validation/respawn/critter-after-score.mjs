// Automated validation for the Respawn item `critter-after-score`.
//
// After completing a crossing into a bay (without clearing the level), a fresh
// critter respawns on the near shore — on solid footing, with the crossing timer
// reset for the next crossing (specs/flow.md, specs/playfield.md). The critter is
// hopped into one open bay of five, then the respawn is read back: WHERE the fresh
// critter comes back. The bear's matching fairness is `hunter.fair-reset-bay`. See
// validation/_helpers.mjs.

import { startCrossing, ROW_NEAR, WATER_TOP } from "../_helpers.mjs";

// Bay index 2 spans cols 19,20 (specs/playfield.md); hopping up from col 20 in the
// top water row enters it, leaving the other four bays open (so this is a between-
// crossings respawn, not a level clear).
const BAY_COL = 20;
const BAY_INDEX = 2;

export default function item() {
  // The bay fill and the respawn it produced, for `assert` to read.
  let filled;
  let r;

  return {
    id: "respawn.critter-after-score",

    // Pose a crossing one hop from completion: the critter on a parked floe in the top
    // water row directly below an open bay, the bays otherwise empty.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setLane", WATER_TOP, { cols: [BAY_COL], speed: 0 }); // floe under the bay
      await api.call("placeCritter", BAY_COL, WATER_TOP);
    },

    // The bay fill and the respawn it triggers — both what is checked and the clip.
    async act(api) {
      await api.call("press", "ArrowUp");
      filled = await api.until((s) => s.bays[BAY_INDEX] === true, {
        max: 60,
        poll: 1,
      });
      r = await api.until(
        (s) => s.phase === "crossing" && s.critter.row === ROW_NEAR,
        { max: 180, poll: 6 }, // 1.5 s — covers the brief bay-fill pause
      );
    },

    async assert(api, check) {
      check.expectOk("the crossing completes into a bay", filled.hit);
      check.expectOk("a fresh crossing begins after the bay", r.hit);
      check.expectEq(
        "the critter respawns on the near shore",
        r.snap.critter.row,
        ROW_NEAR,
      );
      check.expectEq(
        "the critter respawns on solid footing",
        r.snap.critter.footing,
        "solid",
      );
      check.expectEq(
        "one bay filled, the level not cleared",
        r.snap.bays.filter(Boolean).length,
        1,
      );
      check.expectEq("still on the same level", r.snap.level, 1);
      check.expectGt(
        "the crossing timer is reset for the next crossing",
        r.snap.timer,
        r.snap.timerMax - 1,
      );
    },
  };
}
