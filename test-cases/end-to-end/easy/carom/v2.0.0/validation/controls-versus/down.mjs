// Automated validation for the Multi Player Controls sub-item `down`.
//
// In Versus, player two drives the right paddle with the arrow keys. Holding the
// Down arrow must move that paddle down (its center y increases). The match is
// started from the title with injected keys so the game stays under normal keyboard
// control, then the key is held and the real update moves the paddle, read back from
// the snapshot.
//
// The menu navigation is instant, so it poses the match in `arrange`; holding the key
// is the only thing that consumes time, so it is `act` — which is both where the
// verdict is read and what the recorded clip shows. Both paddles' displacement is
// captured in the one hold, so the isolation assertion reads the same drive. See
// validation/_helpers.mjs.

import { arrangeMove, actHoldMove, assertMove } from "../_helpers.mjs";

export default function item() {
  // What `act` measured, read back by `assert`. Each pass gets its own instance, so
  // nothing leaks from the validate pass into the record pass.
  let moved;

  return {
    id: "controls-versus.down",

    async arrange(api) {
      await arrangeMove(api, "versus");
    },

    async act(api) {
      moved = await actHoldMove(api, "right", "ArrowDown");
    },

    async assert(api, check) {
      assertMove(check, moved, {
        code: "ArrowDown",
        up: false,
        who: "player two's right paddle",
        isolate: "left",
      });
    },
  };
}
