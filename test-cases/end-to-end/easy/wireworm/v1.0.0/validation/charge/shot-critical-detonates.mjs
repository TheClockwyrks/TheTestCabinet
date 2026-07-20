// Automated validation for charge.shot-critical-detonates: a bolt into a critical
// node detonates it — removing it entirely and scoring the discharge purge — rather
// than knocking it down a level.
//
// An isolated critical node above the cursor is the precondition; the detonation is
// produced by the real resolveBolt -> hitNode -> detonate path and read back. The
// node is gone (a de-energize would have left it at charge 2), and the score gains
// the discharge purge bonus (larger than an inert node's clear).

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
    id: "charge.shot-critical-detonates",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", C, R, 3); // an isolated critical node
      await api.call("setCursor", tileCX(C), 688);
    },

    // The shot and the detonation it triggers are one scenario, and this is the
    // clip. The pre-shot score is read at the top of `act`, before any time is
    // spent, so the delta the assertion scores belongs to this shot alone.
    async act(api) {
      before = (await api.snapshot()).score;
      snap = await actFireAndResolve(api);
      // Both operands are captured; the sim runs on only so the detonation is
      // legible at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq(
        "the critical node is removed entirely (not de-energized)",
        chargeAt(snap, C, R),
        -1,
      );
      check.expectGt(
        "detonating scores the discharge purge (more than an inert clear)",
        snap.score - before,
        1,
      );
    },
  };
}
