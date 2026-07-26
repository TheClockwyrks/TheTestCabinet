// Automated validation for controls.wasd-w: holding the W key moves the cursor up
// within the band. Injected input flows through the real key handling and moveCursor.

import {
  actHoldMove,
  arrangeMoveControl,
  assertMoveControl,
} from "../_helpers.mjs";

// The cursor starts at the FLOOR of the band so the whole upward displacement is
// measured before the band-top clamp can eat any of it.
const CONTROL = { code: "KeyW", axis: "y", dir: -1 };
const START = { startX: 640, startY: 704 };

export default function item() {
  let r;

  return {
    id: "controls.wasd-w",
    async arrange(api) {
      await arrangeMoveControl(api, START);
    },
    // Holding the key IS the clip: the reviewer watches the cursor slide the way the
    // measured delta says it went.
    async act(api) {
      r = await actHoldMove(api, CONTROL.code);
    },
    async assert(api, check) {
      assertMoveControl(check, r, CONTROL);
    },
  };
}
