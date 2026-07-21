// Automated validation for foes.corruptor-one-bolt: the corruptor dies to a single
// bolt and pays the largest bounty (1000).
//
// A corruptor above the cursor is the precondition; the kill is produced by the real
// resolveBolt -> hitFoe path (a corruptor dies on the first hit) and read back as its
// removal and the score gain.

import { actFireAndResolve, foesOf, freshBoard } from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;

  return {
    id: "foes.corruptor-one-bolt",

    async arrange(api) {
      await freshBoard(api);
      await api.call("spawnFoe", "corruptor", { row: 3, x: 640, vx: 0 });
      await api.call("setCursor", 640, 688);
    },

    // The bolt climbing from the band to row 3 is a long flight, so the resolution
    // cap is doubled — 240 ticks = the old `fireAndResolve(api, 2)`'s 2s.
    async act(api) {
      before = (await api.snapshot()).score;
      snap = await actFireAndResolve(api, { max: 240 });
      // Both operands are captured; the sim runs on only so the kill is legible at
      // the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq(
        "a single bolt kills the corruptor",
        foesOf(snap, "corruptor").length,
        0,
      );
      check.expectEq(
        "the corruptor pays the largest bounty (1000)",
        snap.score - before,
        1000,
      );
    },
  };
}
