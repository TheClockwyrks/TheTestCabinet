// Automated validation for worm.winds-horizontal: on a clear row the worm advances
// one tile per step along its heading, staying on its row and on the board.
//
// A worm on an empty row is the precondition; the motion is produced by the real
// stepWorm and read back. One step moves the head one column along its heading with
// the row unchanged; over many steps every segment stays in bounds.

import {
  COLS,
  ROWS,
  actWormStep,
  actWormSteps,
  freshBoard,
  head,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

export default function item() {
  let s1;
  let s;

  return {
    id: "worm.winds-horizontal",

    async arrange(api) {
      await freshBoard(api);
      await setWorm(api, straightWorm(5, 10, 5, 1), 1, 1); // head at (5,10), heading right
    },

    // One step, then ten more on the same continuous run — the whole eleven-tile
    // wind IS the clip, and it is exactly what the assertions measure.
    async act(api) {
      s1 = await actWormStep(api);
      s = await actWormSteps(api, 10);
    },

    async assert(api, check) {
      check.expectEq(
        "the head advances one column along its heading",
        head(s1).c,
        6,
      );
      check.expectEq("the head stays on its row", head(s1).r, 10);

      const inBounds = s.worms.every((w) =>
        w.segments.every(
          (seg) => seg.c >= 0 && seg.c < COLS && seg.r >= 0 && seg.r < ROWS,
        ),
      );
      check.expectOk("every segment stays on the board", inBounds);
    },
  };
}
