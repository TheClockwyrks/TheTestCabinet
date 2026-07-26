// Automated validation for worm.drop-reverse-edge: blocked by a side edge the worm
// drops and reverses, but charges nothing (there is no node there to charge).
//
// A worm at the left edge heading into it is the precondition; the turn is produced
// by the real stepWorm edge path. The board stays empty of nodes — the edge turn
// creates none.

import {
  actWormStep,
  freshBoard,
  head,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

export default function item() {
  let snap;

  return {
    id: "worm.drop-reverse-edge",

    async arrange(api) {
      await freshBoard(api);
      // Head at column 0 heading left, so the next step runs into the side edge.
      await setWorm(api, straightWorm(0, 5, 4, -1), -1, 1);
    },

    // The one tile-step into the edge is the clip: the reviewer watches the drop and
    // reversal the assertions read.
    async act(api) {
      snap = await actWormStep(api);
      // The snapshot is captured; the sim runs on only so the clip shows the worm
      // heading back across the board rather than a single tile-step.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      check.expectEq("the worm drops one row at the edge", head(snap).r, 6);
      check.expectEq("the worm reverses its heading", snap.worms[0].dh, 1);
      check.expectEq(
        "the edge turn charges nothing (no node created)",
        snap.nodes.length,
        0,
      );
    },
  };
}
