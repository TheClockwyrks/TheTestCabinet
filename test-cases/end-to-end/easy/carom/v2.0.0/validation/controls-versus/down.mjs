// Automated validation for the Multi Player Controls sub-item `down`.
//
// In Versus, player two drives the right paddle with the arrow keys. Holding the
// Down arrow must move that paddle down (its center y increases). The match is
// started from the title with injected keys so the game stays under normal keyboard
// control, then the key is held and the real update moves the paddle, read back from
// the snapshot. See validation/_helpers.mjs.

import { moveCheck } from "../_helpers.mjs";

export default async function drive(api) {
  return {
    verdicts: {
      "controls-versus.down": await moveCheck(api, {
        mode: "versus",
        side: "right",
        code: "ArrowDown",
        up: false,
        who: "player two's right paddle",
        isolate: "left",
      }),
    },
  };
}
