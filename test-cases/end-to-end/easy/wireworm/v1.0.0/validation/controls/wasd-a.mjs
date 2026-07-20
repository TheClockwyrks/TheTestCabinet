// Automated validation for controls.wasd-a: holding the A key moves the cursor left.
// Injected input flows through the real key handling and moveCursor.

import {
  actHoldMove,
  arrangeMoveControl,
  assertMoveControl,
} from "../_helpers.mjs";

// The cursor starts well to the RIGHT so the whole leftward displacement is measured
// before the left-edge clamp can eat any of it.
const CONTROL = { code: "KeyA", axis: "x", dir: -1 };
const START = { startX: 1100, startY: 688 };

export default function item() {
  let r;

  return {
    id: "controls.wasd-a",
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
