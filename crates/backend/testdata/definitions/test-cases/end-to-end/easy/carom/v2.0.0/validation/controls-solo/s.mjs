// Automated validation for the Single Player Controls sub-item `s`.
//
// Holding the S key must move the left paddle down (its center y increases). The
// match is started from the title with injected keys so the game stays under normal
// keyboard control, then the key is held and the real update moves the paddle, which
// the snapshot reads back.
//
// The menu navigation is instant, so it poses the match in `arrange`; holding the key
// is the only thing that consumes time, so it is `act` — which is both where the
// verdict is read and what the recorded clip shows. See validation/_helpers.mjs.

import { arrangeMove, actHoldMove, assertMove } from "../_helpers.mjs";

export default function item() {
  // What `act` measured, read back by `assert`. Each pass gets its own instance, so
  // nothing leaks from the validate pass into the record pass.
  let moved;

  return {
    id: "controls-solo.s",

    async arrange(api) {
      await arrangeMove(api, "solo");
    },

    async act(api) {
      moved = await actHoldMove(api, "left", "KeyS");
    },

    async assert(api, check) {
      assertMove(check, moved, {
        code: "KeyS",
        up: false,
        who: "the left paddle (player one)",
      });
    },
  };
}
