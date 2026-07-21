// Automated validation for controls.arrow-down: holding the Down arrow moves the
// cursor down within the band. Injected input flows through the real key handling and
// moveCursor.

import {
  actHoldMove,
  arrangeMoveControl,
  assertMoveControl,
} from "../_helpers.mjs";

// The cursor starts at the TOP of the band so the whole downward displacement is
// measured before the floor clamp can eat any of it.
const CONTROL = { code: "ArrowDown", axis: "y", dir: 1 };
const START = { startX: 640, startY: 672 };

export default function item() {
  let r;

  return {
    id: "controls.arrow-down",
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
