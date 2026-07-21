// Automated validation for controls.arrow-right: holding the Right arrow moves the
// cursor right. Injected input flows through the real key handling and moveCursor.

import {
  actHoldMove,
  arrangeMoveControl,
  assertMoveControl,
} from "../_helpers.mjs";

// The cursor starts well to the LEFT so the whole rightward displacement is measured
// before the right-edge clamp can eat any of it.
const CONTROL = { code: "ArrowRight", axis: "x", dir: 1 };
const START = { startX: 180, startY: 688 };

export default function item() {
  let r;

  return {
    id: "controls.arrow-right",
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
