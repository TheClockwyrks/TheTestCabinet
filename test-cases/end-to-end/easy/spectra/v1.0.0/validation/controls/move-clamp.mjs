// Automated validation for the Controls sub-item `move-clamp`.
//
// The ship stops at the lane's edges (x 40 and 1240) and does not wrap around. The
// ship is posed a short run inside each bound, a movement key is held long past the
// moment it arrives, and the real clamped update is read while the key is STILL
// HELD: it pins the ship at the bound rather than carrying it around the lane.

import {
  startClean,
  spawnBystander,
  actHoldKey,
  SHIP_MIN_X,
  SHIP_MAX_X,
} from "../_helpers.mjs";

// Where each run starts: 100 px inside the bound it is driving at. At 360 px/s that
// is a third of a second of approach, and the rest of the hold is the ship sitting
// against the wall — which is the check, that it STAYS there rather than merely
// reaches it. A build that wrapped instead would be most of the lane away, over by
// the opposite bound, by the time the snapshot is taken.
const APPROACH_PX = 100;
const LEFT_START_X = SHIP_MIN_X + APPROACH_PX; // 140
const RIGHT_START_X = SHIP_MAX_X - APPROACH_PX; // 1140

// Each hold is the approach plus a readable stretch pinned against the bound.
//
// The old script held 3 s and then 4 s from the centre of the lane. That is 7 s in
// one `act`, and a posed drone can only be relied on to hold its slot for
// `FORMATION_WINDOW_TICKS` — past it the assault peels one into a real dive, at the
// ship, and a drone body costs a life (`specs/polarity.md`). The respawn puts the
// ship back at the centre of the lane, so a dive landing mid-hold reads as the clamp
// failing. Starting near the bound buys the same evidence in a quarter of the time,
// and both runs together now fit inside the window with room to spare.
const HOLD_TICKS = 90; // 0.75 s: ~0.28 s to arrive, ~0.47 s pinned

export default function item() {
  // The ship's x at the end of each held run.
  let left;
  let right;

  return {
    id: "controls.move-clamp",

    // A clean wave with the ship posed a short run from the left bound, and one
    // bystander drone so the wave is live at all: an empty field is a wave the game
    // may call cleared on its first tick, and a game that has left `inWave` stops
    // moving the ship for a held key — which reads as the ship pinned where it
    // started rather than clamped at the bound (see `spawnBystander`).
    async arrange(api) {
      await startClean(api);
      await spawnBystander(api);
      await api.call("setShipX", LEFT_START_X);
    },

    async act(api) {
      // Hold left into the bound: pins at x=40, never wraps to the right edge.
      // The snapshot is read while the key is still held, which is the whole point —
      // a build that wrapped would be somewhere else entirely at this instant.
      left = (await actHoldKey(api, "ArrowLeft", HOLD_TICKS)).ship.x;

      // Re-pose for the second run with a control op. `startClean` (which the old
      // script used here) resets, and the runtime forbids that in `act`: it would
      // take the clock back and freeze the recording. `setShipX` moves the ship
      // without touching the clock, which is all this scenario needs.
      await api.call("setShipX", RIGHT_START_X);

      // Hold right into the bound: pins at x=1240.
      right = (await actHoldKey(api, "ArrowRight", HOLD_TICKS)).ship.x;
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
