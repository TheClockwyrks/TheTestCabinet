// Automated validation for foes.glitch-eats: the glitch removes any node it passes
// over, of any charge (even a critical node).
//
// A critical node is the precondition and a glitch is posed over it mid-clip; the eat
// is produced by the real updateFoe glitch branch (game.eatNode) when the sim steps
// and read back as the node's disappearance.
//
// The node stands alone for the opening of the clip, and the glitch arrives onto it
// only after that. Posing both up front left the eat over within 50 ms of `act`
// starting, and the clip — which cannot begin filming the instant the pass does —
// opened on a bare board, with no node in it at any point to be seen eaten.

import { chargeAt, freshBoard, tileCX, tileCY } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "foes.glitch-eats",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 20, 10, 3); // a critical node
    },

    async act(api) {
      // Two seconds is enough to read the standing critical node and no more: the eat
      // itself is what the reviewer is here for.
      await api.advance(240);
      before = chargeAt(await api.snapshot(), 20, 10);
      // The glitch is posed directly ONTO the node, exactly as the old verdict did.
      // It cannot instead be released above and allowed to skitter down onto it — the
      // way the two costs-a-life items now let their foe arrive — because a glitch
      // re-picks a random horizontal dart several times a second (foes.glitch-zigzag
      // checks exactly that), so it would wander tiles clear of the node's column and
      // this check would be deciding on a coin toss. Nor does the clip lay a row of
      // nodes for a glitch to skitter across, as an older tail did: that is a
      // different scenario from the one the assertions drive, and the checked one
      // wins.
      await api.call("spawnFoe", "glitch", {
        x: tileCX(20),
        y: tileCY(10),
        vx: 0,
      });
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
