// Automated validation for worm.drop-reverse-node: blocked by a chargeable node the
// worm drops one row and reverses its horizontal heading (and charges the node).
//
// A node ahead of the worm is the precondition; the drop-and-reverse is produced by
// the real stepWorm block path and read back.

import {
  actWormStep,
  chargeAt,
  freshBoard,
  head,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;

  return {
    id: "worm.drop-reverse-node",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 10, 5, 0);
      await setWorm(api, straightWorm(9, 5, 5, 1), 1, 1); // heading right into the node
    },

    // The one tile-step into the node is the clip: the reviewer watches the drop,
    // the reversal and the charge the assertions read.
    async act(api) {
      before = (await api.snapshot()).worms[0];
      snap = await actWormStep(api);
      // Every operand is captured; the sim runs on only so the clip shows the worm
      // heading back the other way rather than a single tile-step.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      check.expectEq("the worm starts heading right", before.dh, 1);
      check.expectEq("the worm drops one row when blocked", head(snap).r, 6);
      check.expectEq("the worm reverses its heading", snap.worms[0].dh, -1);
      check.expectEq("the blocking node is charged", chargeAt(snap, 10, 5), 1);
    },
  };
}
