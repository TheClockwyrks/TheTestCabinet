// Automated validation for the Paddle Movement sub-item `speed-versus-p2`.
//
// In Versus player two drives the right paddle with the arrow keys at 720 px/s while
// a movement key is held (modes.md). A Versus match is started from the title with
// injected keys, then the Down arrow is held and the right paddle's displacement over
// a known span is measured back into a speed. See validation/_helpers.mjs.

import { arrangeMove, actHoldMove, assertHumanSpeed } from "../_helpers.mjs";

export default function item() {
  let moved;

  return {
    id: "paddle-movement.speed-versus-p2",

    async arrange(api) {
      await arrangeMove(api, "versus");
    },

    async act(api) {
      moved = await actHoldMove(api, "right", "ArrowDown");
    },

    async assert(api, check) {
      assertHumanSpeed(check, moved, {
        code: "ArrowDown",
        who: "player two's right paddle in Versus",
      });
    },
  };
}
