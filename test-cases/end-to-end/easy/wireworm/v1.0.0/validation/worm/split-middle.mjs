// Automated validation for worm.split-middle: a bolt into a middle segment splits
// the worm into two independent worms.
//
// A straight worm on a low row (so the bolt resolves before the worm steps) is the
// precondition; the split is produced by the real hitWorm -> splitRuns and read
// back as two worms.

import {
  actFireAndResolve,
  actWormToColumn,
  freshBoard,
  setWorm,
  straightWorm,
  tileCX,
} from "../_helpers.mjs";

// Row 17 keeps the bolt's flight (about 0.04 s from the muzzle) well inside the
// 0.14 s between worm tile steps, so the segment aimed at is still in the column
// when the bolt arrives.
const R = 17;
// The worm winds in and the shot is taken the instant its head lands on FIRE_AT_C,
// which lays the five segments across FIRE_AT_C-4..FIRE_AT_C. Posed on the firing
// mark it was shot on the clip's first frame; posed six tiles short it is filmed
// winding in first (see `actWormToColumn`).
const FIRE_AT_C = 10;
const START_C = FIRE_AT_C - 6;
const MIDDLE_C = FIRE_AT_C - 2; // the middle of the five segments

export default function item() {
  let before;
  let snap;

  return {
    id: "worm.split-middle",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, straightWorm(START_C, R, 5, 1), 1, 1);
      await api.call("setCursor", tileCX(MIDDLE_C), 688); // under the middle segment
    },

    // The approach and the shot into the middle are the clip: the reviewer watches
    // the worm wind over the cursor, then one worm become two and each half wind off
    // on its own.
    async act(api) {
      await actWormToColumn(api, FIRE_AT_C); // ~0.84s of visible approach
      before = (await api.snapshot()).worms.length;
      snap = await actFireAndResolve(api);
      // Both operands are captured; the sim runs on only so the clip shows the two
      // halves separating rather than ending on the frame of the hit.
      await api.advance(120); // 1s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("one worm before the shot", before, 1);
      check.expectEq(
        "a middle-segment hit splits the worm into two",
        snap.worms.length,
        2,
      );
    },
  };
}
