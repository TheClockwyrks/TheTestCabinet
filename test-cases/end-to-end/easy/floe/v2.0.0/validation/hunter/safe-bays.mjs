// Automated validation for the Hunter item `safe-bays`.
//
// The bear never enters the far-shore wall or a bay, so a critter safe in a filled
// bay is permanently safe from it. The critter is placed in a filled bay (row 1)
// and a bear set below it on cleared water; over many steps the real pursuit never
// reaches row 1 and never catches the critter. See validation/_helpers.mjs.

import { startCrossing, BAY_COL, ROW_BAYS } from "../_helpers.mjs";

// How far the bear must actually travel during the watch for "it never got in" to
// mean anything, in px. THIS ITEM'S CLAIM IS NEGATIVE — the bear does not enter the
// wall or a bay — and a negative claim is satisfied trivially by a bear that cannot
// move at all. Without this, a build whose pursuit is completely broken passes an
// item about the bay being a SANCTUARY, and reads to a reviewer as a rule that was
// demonstrated when nothing ever tested it.
//
// The threshold is low on purpose: the bear starts one row below the shore and is
// meant to be stopped almost at once, so the reference only covers ~29 px pressing
// up against it. A quarter of a tile still separates a bear that moved and was
// blocked from one that never moved at all.
const MIN_BEAR_PATH_PX = 8;

export default function item() {
  // The shallowest row the bear ever reached, how far it actually covered trying,
  // and the state at the end of the watch.
  let minRow;
  let bearPath;
  let final;

  return {
    id: "hunter.safe-bays",

    // Pose the critter safe in a filled bay with the bear right below it on cleared
    // open water — nothing between them but the far-shore wall, so the only thing
    // keeping the bear out is the rule under test.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setBays", [true, false, false, false, false]);
      for (const r of [2, 3]) await api.call("setLane", r, { cols: [] }); // open water below the bay
      await api.call("placeCritter", BAY_COL[0], ROW_BAYS); // safe in the filled bay
      await api.call("setBear", 0, { col: 3, row: 3 });
    },

    // Two seconds of the real pursuit pressing against the far shore, sampled every
    // 0.05 s so a momentary incursion into row 1 could not slip between reads. The
    // bear straining at the shore and never getting in is also the clip.
    async act(api) {
      minRow = 99;
      bearPath = 0;
      // The bear's position at the previous sample, for accumulating its path.
      let prevBear = null;
      for (let k = 0; k < 40; k += 1) {
        await api.advance(6); // 0.05 s
        const s = await api.snapshot();
        const bear = s.bears[0];
        if (bear.present) {
          minRow = Math.min(minRow, bear.row);
          // Accumulate its real travel, so being kept out is only credited to a bear
          // that actually came at the shore.
          if (prevBear) {
            bearPath += Math.hypot(bear.x - prevBear.x, bear.y - prevBear.y);
          }
          prevBear = bear;
        }
      }
      final = await api.snapshot();
    },

    async assert(api, check) {
      check.expectGe(
        "the bear never enters the far-shore wall / a bay (row < 2)",
        minRow,
        2,
      );
      check.expectGt(
        "the bear was actually pressing at the shore (not stuck in place)",
        bearPath,
        MIN_BEAR_PATH_PX,
      );
      check.expectNe(
        "the critter in the filled bay is never caught",
        final.phase,
        "dying",
      );
      check.expectEq("the critter kept all lives", final.lives, 3);
    },
  };
}
