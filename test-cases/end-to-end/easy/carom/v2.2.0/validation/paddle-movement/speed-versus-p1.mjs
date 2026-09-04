// Automated validation for the Paddle Movement sub-item `speed-versus-p1`.
//
// In Versus player one drives the left paddle with W/S at 720 px/s while a movement
// key is held (modes.md). A Versus match is started from the title with injected
// keys, then S is held and the left paddle's displacement over a known span is
// measured back into a speed. See validation/_helpers.mjs.

import { arrangeMove, actHoldMove, assertHumanSpeed } from "../_helpers.mjs";

export default function item() {
  let moved;

  return {
    id: "paddle-movement.speed-versus-p1",

    async arrange(api) {
      await arrangeMove(api, "versus");
    },

    async act(api) {
      moved = await actHoldMove(api, "left", "KeyS");
    },

    async assert(api, check) {
      assertHumanSpeed(check, moved, {
        code: "KeyS",
        who: "player one's left paddle in Versus",
      });
    },
  };
}
