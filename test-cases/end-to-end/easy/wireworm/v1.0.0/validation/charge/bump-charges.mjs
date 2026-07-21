// Automated validation for charge.bump-charges: a chargeable node the worm is
// turned by gains one charge.
//
// An inert node and a worm heading into it are the preconditions; the +1 charge is
// produced by the real stepWorm -> chargeNode path when the sim steps, read back
// from the snapshot.

import {
  actWormStep,
  chargeAt,
  freshBoard,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;

  return {
    id: "charge.bump-charges",

    // The scene: one inert node with a worm a tile short of it, heading in.
    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 20, 5, 0); // an inert node
      await setWorm(api, straightWorm(19, 5, 5, 1), 1, 1); // head at (19,5), heading right into it
    },

    // One real worm tile-step carries the head into the node and runs the real
    // chargeNode path. This IS the clip: the reviewer watches the very ricochet
    // whose charge the assertions read.
    async act(api) {
      before = await api.snapshot();
      snap = await actWormStep(api);
      // Both operands are captured, so nothing past this point can affect the
      // verdict — it runs on purely so the clip shows the worm ricocheting away
      // from the node it charged rather than a single tile-step.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      check.expectEq("the node starts inert", chargeAt(before, 20, 5), 0);
      check.expectEq(
        "the bumped node gains one charge",
        chargeAt(snap, 20, 5),
        1,
      );
    },
  };
}
