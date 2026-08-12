// Automated validation for worm.drop-reverse-edge: blocked by a side edge the worm
// drops and reverses, but charges nothing (there is no node there to charge).
//
// A worm at the left edge heading into it is the precondition; the turn is produced
// by the real stepWorm edge path. The board stays empty of nodes — the edge turn
// creates none.

import {
  actWormStep,
  actWormToColumn,
  freshBoard,
  head,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

const R = 5;
// Six tiles of empty board between the head and the left edge, so the clip opens
// on the worm winding toward the wall rather than on the turn (see
// `actWormToColumn`).
const START_C = 6;

export default function item() {
  let snap;

  return {
    id: "worm.drop-reverse-edge",

    async arrange(api) {
      await freshBoard(api);
      // Heading left, several tiles short of the side edge it will turn on.
      await setWorm(api, straightWorm(START_C, R, 4, -1), -1, 1);
    },

    // The run-up and the tile-step into the edge are the clip: the reviewer watches
    // the worm reach the wall, then the drop and reversal the assertions read.
    async act(api) {
      await actWormToColumn(api, 0); // ~0.84s of visible approach to the edge
      snap = await actWormStep(api);
      // The snapshot is captured; the sim runs on only so the clip shows the worm
      // heading back across the board rather than a single tile-step.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      check.expectEq("the worm drops one row at the edge", head(snap).r, R + 1);
      check.expectEq("the worm reverses its heading", snap.worms[0].dh, 1);
      check.expectEq(
        "the edge turn charges nothing (no node created)",
        snap.nodes.length,
        0,
      );
    },
  };
}
