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

// Half a second of the posed start before the key goes down. The band is only 32 px
// tall and the cursor crosses it in about 75 ms, so without this the clip opened
// with the cursor already sitting on the floor: the whole movement was over in a
// frame or two at the very start and read as a cursor holding its position rather
// than one that had moved. It cannot touch the verdict — nothing moves the cursor
// until a key is held, and the deltas are measured from a snapshot taken after this
// (see `actHoldMove`).
const LEAD_TICKS = 60;

export default function item() {
  let r;

  return {
    id: "controls.arrow-down",
    async arrange(api) {
      await arrangeMoveControl(api, START);
    },
    // Holding the key IS the clip: the reviewer sees the cursor at the top of the
    // band, then watches it slide the way the measured delta says it went.
    async act(api) {
      r = await actHoldMove(api, CONTROL.code, { leadTicks: LEAD_TICKS });
    },
    async assert(api, check) {
      assertMoveControl(check, r, CONTROL);
    },
  };
}
