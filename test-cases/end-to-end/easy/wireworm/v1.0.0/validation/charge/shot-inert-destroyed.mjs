// Automated validation for charge.shot-inert-destroyed: a bolt into an inert node
// removes it (and scores), never raising its charge.
//
// An inert node above the cursor is the precondition; the destruction is produced
// by the real resolveBolt -> hitNode path as the bolt travels up and is read back.

import {
  actFireAndResolve,
  chargeAt,
  freshBoard,
  tileCX,
} from "../_helpers.mjs";

const C = 20;
const R = 10;

export default function item() {
  let before;
  let snap;

  return {
    id: "charge.shot-inert-destroyed",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", C, R, 0);
      await api.call("setCursor", tileCX(C), 688);
    },

    // The bolt climbing the column and clearing the node is the clip. The pre-shot
    // score is read at the top of `act`, before any time is spent, so the score
    // comparison belongs to this shot alone.
    async act(api) {
      before = (await api.snapshot()).score;
      snap = await actFireAndResolve(api);
      // Both operands are captured; the sim runs on only so the cleared tile is
      // legible at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq(
        "the inert node is destroyed by the bolt",
        chargeAt(snap, C, R),
        -1,
      );
      check.expectGt("shooting an inert node scores", snap.score, before);
    },
  };
}
