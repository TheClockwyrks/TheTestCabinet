// Automated validation for charge.bump-charges: a chargeable node the worm is
// turned by gains one charge.
//
// An inert node and a worm heading into it are the preconditions; the +1 charge is
// produced by the real stepWorm -> chargeNode path when the sim steps, read back
// from the snapshot.

import {
  actWormStep,
  actWormToColumn,
  chargeAt,
  freshBoard,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

const NODE_C = 20;
const R = 5;
// Where the worm's head is posed, six tiles short of the node: the run-up is what
// the reviewer watches before the bump (see `actWormToColumn`).
const START_C = NODE_C - 7;

export default function item() {
  let before;
  let snap;

  return {
    id: "charge.bump-charges",

    // The scene: one inert node with a worm several tiles short of it, heading in.
    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", NODE_C, R, 0); // an inert node
      await setWorm(api, straightWorm(START_C, R, 5, 1), 1, 1); // heading right at it
    },

    // The worm winds in across empty tiles — nothing to charge on the way — and the
    // tile-step that follows carries the head into the node and runs the real
    // chargeNode path. This IS the clip: the reviewer watches the approach and then
    // the very ricochet whose charge the assertions read.
    async act(api) {
      await actWormToColumn(api, NODE_C - 1); // ~0.84s of visible approach
      before = await api.snapshot();
      snap = await actWormStep(api);
      // Both operands are captured, so nothing past this point can affect the
      // verdict — it runs on purely so the clip shows the worm ricocheting away
      // from the node it charged rather than a single tile-step.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      check.expectEq("the node starts inert", chargeAt(before, NODE_C, R), 0);
      check.expectEq(
        "the bumped node gains one charge",
        chargeAt(snap, NODE_C, R),
        1,
      );
    },
  };
}
