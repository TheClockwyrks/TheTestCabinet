// Automated validation for foes.glitch-one-bolt: the glitch dies to a single bolt
// and pays its bounty (300).
//
// A glitch above the cursor is the precondition; the kill is produced by the real
// resolveBolt -> hitFoe path (a glitch dies on the first hit) and read back as the
// foe's removal and the score gain.

import { actFireAndResolve, foesOf, freshBoard, tileCY } from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;

  return {
    id: "foes.glitch-one-bolt",

    async arrange(api) {
      await freshBoard(api);
      await api.call("spawnFoe", "glitch", { x: 640, y: tileCY(13), vx: 0 });
      await api.call("setCursor", 640, 688);
    },

    // The bolt climbing to the glitch and killing it is the clip. The pre-shot score
    // is read at the top of `act`, before any time is spent, so the bounty the
    // assertion reads belongs to this kill alone.
    async act(api) {
      before = (await api.snapshot()).score;
      snap = await actFireAndResolve(api);
      // Both operands are captured; the sim runs on only so the kill is legible at
      // the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq(
        "a single bolt kills the glitch",
        foesOf(snap, "glitch").length,
        0,
      );
      check.expectEq(
        "the glitch pays its bounty (300)",
        snap.score - before,
        300,
      );
    },
  };
}
