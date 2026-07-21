// Automated validation for foes.glitch-eats: the glitch removes any node it passes
// over, of any charge (even a critical node).
//
// A critical node and a glitch posed over it are the preconditions; the eat is
// produced by the real updateFoe glitch branch (game.eatNode) when the sim steps and
// read back as the node's disappearance.

import { chargeAt, freshBoard, tileCX, tileCY } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "foes.glitch-eats",

    // The glitch is posed directly over the critical node, exactly as the old
    // verdict did. The old clip tail instead laid a row of nodes for a glitch to
    // skitter across — a different scenario from the one the assertions drive, so
    // the checked one wins and the clip films it.
    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 20, 10, 3); // a critical node
      await api.call("spawnFoe", "glitch", {
        x: tileCX(20),
        y: tileCY(10),
        vx: 0,
      });
    },

    async act(api) {
      before = chargeAt(await api.snapshot(), 20, 10);
      await api.advance(6); // 6 ticks = the old 0.05s — one sim beat, enough for the eat
      after = chargeAt(await api.snapshot(), 20, 10);
      // Both operands are captured; the sim runs on only so the clip shows the
      // glitch skittering onward rather than ending on a single frame.
      await api.advance(120); // 1s of visible play
    },

    async assert(api, check) {
      check.expectEq(
        "the critical node stands before the glitch passes",
        before,
        3,
      );
      check.expectEq("the glitch eats the node, of any charge", after, -1);
    },
  };
}
