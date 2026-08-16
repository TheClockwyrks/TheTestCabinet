// Automated validation for charge.critical-dive: a worm blocked by a critical node
// dives straight down its own column instead of the normal drop-and-reverse.
//
// A critical node with a worm heading into it are the preconditions; the dive is
// produced by the real stepWorm critical-node branch. The worm's head holds its
// column and its row keeps increasing as it plunges.

import {
  actWormStep,
  actWormToColumn,
  freshBoard,
  head,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

const NODE_C = 20;
const R = 5;
// Six tiles of run-up, so the clip shows the worm winding along its row before the
// critical node turns that into a plunge (see `actWormToColumn`).
const START_C = NODE_C - 7;

export default function item() {
  let s1;
  let s2;
  let s3;

  return {
    id: "charge.critical-dive",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", NODE_C, R, 3); // a critical node
      await setWorm(api, straightWorm(START_C, R, 5, 1), 1, 1); // heading at it
      await api.call("setCursor", 100, 700); // out of the dive column
    },

    // The run-up, then three real worm tile-steps: the first enters the dive, the
    // next two prove the plunge continues. This is the clip — the reviewer watches
    // the worm wind in and then the very dive the assertions read.
    async act(api) {
      await actWormToColumn(api, NODE_C - 1); // ~0.84s of visible approach
      s1 = await actWormStep(api);
      // Keep diving: the column stays fixed and the row keeps increasing.
      s2 = await actWormStep(api);
      s3 = await actWormStep(api);
      // All three snapshots are captured; the sim runs on only so the clip reads as
      // a plunge down the column rather than three tile-steps.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      const h1 = head(s1);
      check.expectOk(
        "the worm enters a dive at the critical node",
        s1.worms[0].diving,
      );
      check.expectEq("the dive holds the head's column", h1.c, NODE_C - 1);
      check.expectGt("the head drops a row on the first dive step", h1.r, R);

      check.expectEq(
        "the column stays fixed while diving",
        head(s3).c,
        NODE_C - 1,
      );
      check.expectGt(
        "the row keeps increasing while diving",
        head(s3).r,
        head(s2).r,
      );
    },
  };
}
