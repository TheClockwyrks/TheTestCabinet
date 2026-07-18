// Automated validation for the Multi Player Controls sub-item `up`.
//
// In Versus, player two drives the right paddle with the arrow keys. Holding the Up
// arrow must move that paddle up (its center y decreases). The match is started from
// the title with injected keys so the game stays under normal keyboard control, then
// the key is held and the real update moves the paddle, read back from the snapshot.
// See validation/_helpers.mjs.

import { moveCheck } from "../_helpers.mjs";

export default async function drive(api) {
  return {
    verdicts: {
      "controls-versus.up": await moveCheck(api, {
        mode: "versus",
        side: "right",
        code: "ArrowUp",
        up: true,
        who: "player two's right paddle",
        isolate: "left",
      }),
    },
  };
}
