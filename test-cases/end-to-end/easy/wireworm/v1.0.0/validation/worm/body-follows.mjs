// Automated validation for worm.body-follows: each segment follows the one ahead,
// so consecutive segments stay orthogonally adjacent (one tile apart, never
// diagonal).
//
// A worm is stepped through several tiles (including a turn at a node); the body
// motion is produced by the real advanceBody. Every consecutive segment pair is
// checked to be exactly one orthogonal tile apart.

import {
  actWormSteps,
  freshBoard,
  setWorm,
  straightWorm,
} from "../_helpers.mjs";

function allOrthogonallyAdjacent(worms) {
  for (const w of worms) {
    for (let i = 0; i < w.segments.length - 1; i++) {
      const a = w.segments[i];
      const b = w.segments[i + 1];
      const d = Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
      if (d !== 1) return false; // diagonal (2) or gap (>1) or overlap (0)
    }
  }
  return true;
}

export default function item() {
  let snap;

  return {
    id: "worm.body-follows",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 15, 10, 0); // force a turn partway through
      await setWorm(api, straightWorm(10, 10, 6, 1), 1, 1);
    },

    // Twelve tile-steps carry the worm through the node and out the other side. The
    // whole run IS the clip: the reviewer watches the body track the head around the
    // turn, which is exactly what the assertion measures.
    async act(api) {
      snap = await actWormSteps(api, 12);
    },

    async assert(api, check) {
      check.expectGt("the worm is still on the board", snap.worms.length, 0);
      check.expectOk(
        "every consecutive segment pair stays orthogonally adjacent (never diagonal)",
        allOrthogonallyAdjacent(snap.worms),
      );
    },
  };
}
