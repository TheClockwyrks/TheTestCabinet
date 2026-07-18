// Automated validation for the Single Player Controls sub-item `w`.
//
// Holding the W key must move the left paddle up (its center y decreases). The
// match is started from the title with injected keys so the game stays under normal
// keyboard control, then the key is held and the real update moves the paddle, which
// the snapshot reads back. See validation/_helpers.mjs.

import { moveCheck } from "../_helpers.mjs";

export default async function drive(api) {
  return {
    verdicts: {
      "controls-solo.w": await moveCheck(api, {
        mode: "solo",
        side: "left",
        code: "KeyW",
        up: true,
        who: "the left paddle (player one)",
      }),
    },
  };
}
