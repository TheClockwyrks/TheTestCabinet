// Automated validation for the Hunter item `catches`.
//
// A bear that reaches the critter catches it — a life is lost. A bear is placed a
// few tiles along the median from a stationary critter; the real pursuit closes the
// gap and the catch resolves, which the snapshot reads back. See
// validation/_helpers.mjs.
//
// THE BEAR IS GIVEN GROUND TO COVER. Posed on the adjacent tile it had a third of a
// second to lunge, which the check reads perfectly well but which films as a bear
// already touching the critter and then a cut — a reviewer sees the catch's
// aftermath and has to take the pursuit on trust. Five tiles of median is about a
// second and a half of the bear actually closing, which is the behavior the item is
// about, and the clip holds for a moment after the catch lands. What is under test
// is unchanged: a stationary critter a bear reaches is caught.

import { startCrossing, ROW_MEDIAN } from "../_helpers.mjs";

// Where the critter waits and where the bear starts, both on the solid median, and
// how long the clip keeps filming after the catch.
const CRITTER_COL = 20;
const BEAR_COL = 25;
const TAIL_TICKS = 96; // 0.8 s

export default function item() {
  // The sweep that waited for the catch.
  let r;

  return {
    id: "hunter.catches",

    // Pose the catch: the critter parked on the solid median, a bear a few tiles
    // along it, and a full three lives so the loss reads as a decrement.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("placeCritter", CRITTER_COL, ROW_MEDIAN); // median, solid
      await api.call("setBear", 0, { col: BEAR_COL, row: ROW_MEDIAN });
    },

    // The bear closing the gap and lunging — the real pursuit resolving into the
    // catch, and a moment after it. Both what is checked and what the clip shows.
    //
    // The window is sized for the bear to cross those tiles at the level-1 pace
    // specs/hunter.md sets, with room to spare: what the item asserts is that a bear
    // which reaches the critter catches it, not how quickly this build's bear runs.
    async act(api) {
      r = await api.until((s) => s.phase === "dying", { max: 480, poll: 6 }); // 4 s
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("a pursuing bear catches a stationary critter", r.hit);
      check.expectEq("the phase is dying after a catch", r.snap.phase, "dying");
      check.expectEq("a life is lost to the bear", r.snap.lives, 2);
    },
  };
}
