// Automated validation for worm.split-middle: a bolt into a middle segment splits
// the worm into two independent worms.
//
// A straight worm on a low row (so the bolt resolves before the worm steps) is the
// precondition; the split is produced by the real hitWorm -> splitRuns and read
// back as two worms.

import {
  actFireAndResolve,
  freshBoard,
  setWorm,
  straightWorm,
  tileCX,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;

  return {
    id: "worm.split-middle",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, straightWorm(10, 15, 5, 1), 1, 1); // segments at columns 10..6
      await api.call("setCursor", tileCX(8), 688); // aimed at the middle segment (column 8)
    },

    // The shot into the middle is the clip: the reviewer watches one worm become two
    // and each half wind off on its own.
    async act(api) {
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
