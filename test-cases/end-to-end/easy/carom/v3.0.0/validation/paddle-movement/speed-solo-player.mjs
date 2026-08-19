// Automated validation for the Paddle Movement sub-item `speed-solo-player`.
//
// In Solo the human's paddle (left) moves at 720 px/s while a movement key is held
// (modes.md). A match is started from the title with injected keys — so the game
// stays under normal keyboard control — then a movement key is held and the paddle's
// displacement over a known span is measured back into a speed. See
// validation/_helpers.mjs.

import { arrangeMove, actHoldMove, assertHumanSpeed } from "../_helpers.mjs";

export default function item() {
  let moved;

  return {
    id: "paddle-movement.speed-solo-player",

    async arrange(api) {
      await arrangeMove(api, "solo");
    },

    async act(api) {
      moved = await actHoldMove(api, "left", "KeyS");
    },

    async assert(api, check) {
      assertHumanSpeed(check, moved, {
        code: "KeyS",
        who: "the human paddle (left) in Solo",
      });
    },
  };
}
