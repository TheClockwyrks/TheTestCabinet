// Automated validation for the Multi Player Controls sub-item `w`.
//
// In Versus, player one drives the left paddle with W/S. Holding the W key must move
// that paddle up (its center y decreases). The match is started from the title with
// injected keys so the game stays under normal keyboard control, then the key is held
// and the real update moves the paddle, read back from the snapshot.
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
    id: "controls-versus.w",

    async arrange(api) {
      await arrangeMove(api, "versus");
    },

    async act(api) {
      moved = await actHoldMove(api, "left", "KeyW");
    },

    async assert(api, check) {
      assertMove(check, moved, {
        code: "KeyW",
        up: true,
        who: "player one's left paddle",
        isolate: "right",
      });
    },
  };
}
