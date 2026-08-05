// Automated validation for foes.glitch-one-bolt: the glitch dies to a single bolt
// and pays its bounty (300).
//
// A glitch above the cursor is the precondition; the kill is produced by the real
// resolveBolt -> hitFoe path (a glitch dies on the first hit) and read back as the
// foe's removal and the score gain.
//
// "No glitch on the board afterwards" is the outcome, but on its own it is not
// evidence of a KILL: a board that never had a glitch reads the same, and so does one
// whose foes were cleared out from under the shot. So the glitch is confirmed
// standing before the bolt is fired, and the level is confirmed unchanged across it.
//
// The second guard is not hypothetical. A build whose level-clear condition is an
// unguarded "no worm segments on the board" treats the worm-less board `enterPlay`
// is specified to produce (specs/instrumentation.md) as a cleared level on the very
// first tick: it wipes every foe and bolt and banks `100 * level`. Read loosely, the
// glitch's disappearance looked like a clean one-bolt kill when nothing had been shot
// at all.

import { actShootFoeDead, foesOf, freshBoard, tileCY } from "../_helpers.mjs";

export default function item() {
  let before;
  let levelBefore;
  let glitchesBefore;
  let snap;

  return {
    id: "foes.glitch-one-bolt",

    async arrange(api) {
      await freshBoard(api);
      await api.call("spawnFoe", "glitch", { x: 640, y: tileCY(13), vx: 0 });
      await api.call("setCursor", 640, 688);
    },

    // The bolt climbing to the glitch and killing it is the clip. The whole pre-shot
    // reading is taken at the top of `act`, before any time is spent, so the bounty
    // and the removal the assertions read belong to this kill alone.
    async act(api) {
      const start = await api.snapshot();
      before = start.score;
      levelBefore = start.level;
      glitchesBefore = foesOf(start, "glitch").length;
      // Waits for the glitch to actually leave the board, not just for the bolt to
      // be consumed — see `actShootFoeDead`.
      snap = await actShootFoeDead(api, "glitch");
      // Both operands are captured; the sim runs on only so the kill is legible at
      // the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("a glitch stands before the shot", glitchesBefore, 1);
      check.expectEq(
        "the shot resolves inside the posed level",
        snap.level,
        levelBefore,
      );
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
