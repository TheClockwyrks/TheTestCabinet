// Automated validation for the Controls sub-item `move-clamp`.
//
// The ship stops at the lane's edges (x 40 and 1240) and does not wrap around. A
// movement key is held long enough to reach the edge, and the real clamped update
// pins the ship there rather than wrapping.

import {
  startClean,
  actHoldKey,
  SHIP_MIN_X,
  SHIP_MAX_X,
} from "../_helpers.mjs";

// Long enough for the ship to cross the lane and sit pinned for a while. From
// centre (640) the left bound is 600 px away and the right bound 600 px, at
// 360 px/s — under 2 s each — so both holds are comfortably past arrival, which is
// the point: the check is that the ship STAYS at the bound, not merely reaches it.
const LEFT_HOLD_TICKS = 360; // 360 ticks = the old 3 s
const RIGHT_HOLD_TICKS = 480; // 480 ticks = the old 4 s

export default function item() {
  // The ship's x at the end of each held run.
  let left;
  let right;

  return {
    id: "controls.move-clamp",

    // A clean wave with the ship at centre, equidistant from both bounds.
    async arrange(api) {
      await startClean(api);
      await api.call("setShipX", 640);
    },

    async act(api) {
      // Hold left into the bound: pins at x=40, never wraps to the right edge.
      // The snapshot is read while the key is still held, which is the whole point —
      // a build that wrapped would be somewhere else entirely at this instant.
      left = (await actHoldKey(api, "ArrowLeft", LEFT_HOLD_TICKS)).ship.x;

      // Re-pose to centre for the second run with a control op. `startClean` (which
      // the old script used here) resets, and the runtime forbids that in `act`:
      // it would take the clock back and freeze the recording. `setShipX` moves the
      // ship without touching the clock, which is all this scenario needs.
      await api.call("setShipX", 640);

      // Hold right into the bound: pins at x=1240.
      right = (await actHoldKey(api, "ArrowRight", RIGHT_HOLD_TICKS)).ship.x;
    },

    async assert(api, check) {
      check.expectClose(
        "holding left pins the ship at the left bound",
        left,
        SHIP_MIN_X,
        0.5,
      );
      check.expectClose(
        "holding right pins the ship at the right bound",
        right,
        SHIP_MAX_X,
        0.5,
      );
    },
  };
}
