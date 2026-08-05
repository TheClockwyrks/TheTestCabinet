// Automated validation for worm.drop-reverse-node: blocked by a chargeable node the
// worm drops one row and reverses its horizontal heading (and charges the node).
//
// A node ahead of the worm is the precondition; the drop-and-reverse is produced by
// the real stepWorm block path and read back.

import {
  actWormStep,
  actWormToColumn,
  chargeAt,
  freshBoard,
  head,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

// The node sits far enough along the row that the worm has six tiles of empty
// board to wind across first — the run-up the clip opens on (see
// `actWormToColumn`). Nothing is on those tiles, so it cannot touch the verdict.
const NODE_C = 16;
const R = 5;
const START_C = NODE_C - 7;

export default function item() {
  let before;
  let snap;

  return {
    id: "worm.drop-reverse-node",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", NODE_C, R, 0);
      await setWorm(api, straightWorm(START_C, R, 5, 1), 1, 1); // heading at the node
    },

    // The run-up and the tile-step into the node are the clip: the reviewer watches
    // the worm wind in, then the drop, the reversal and the charge the assertions
    // read.
    async act(api) {
      await actWormToColumn(api, NODE_C - 1); // ~0.84s of visible approach
      before = (await api.snapshot()).worms[0];
      snap = await actWormStep(api);
      // Every operand is captured; the sim runs on only so the clip shows the worm
      // heading back the other way rather than a single tile-step.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      check.expectEq("the worm starts heading right", before.dh, 1);
      check.expectEq(
        "the worm drops one row when blocked",
        head(snap).r,
        R + 1,
      );
      check.expectEq("the worm reverses its heading", snap.worms[0].dh, -1);
      check.expectEq(
        "the blocking node is charged",
        chargeAt(snap, NODE_C, R),
        1,
      );
    },
  };
}
