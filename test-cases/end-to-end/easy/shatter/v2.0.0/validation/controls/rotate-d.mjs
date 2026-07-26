// Automated validation for the Controls item `rotate-d`: the D key rotates the ship
// clockwise (the alternate rotate binding). D is held and the real sim stepped; the facing
// must swing CW at the ~300 deg/s turn rate.
//
// The ship's pose is the precondition (`arrange`); holding the key while the real sim runs is
// the behavior under test (`act`), so the half-second hold IS the clip — the reviewer watches
// the same turn whose measured rate decides the verdict.
//
// The hold is 0.5 s x 120 Hz = 60 ticks. The `* 0.5` in the expected angle stays in SECONDS:
// SHIP_TURN is a rate in rad/s, so the expected swing is rate x half a second.

import { newGame, poseShip, actHoldKey, SHIP_TURN } from "../_helpers.mjs";

export default function item() {
  // The ship's facing before and after the hold, read by `assert`.
  let held;

  return {
    id: "controls.rotate-d",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 400, y: 360, vx: 0, vy: 0, angle: 0 });
    },

    async act(api) {
      held = await actHoldKey(api, "KeyD", 60);
    },

    async assert(api, check) {
      check.expectClose(
        "D turns the ship CW at ~300 deg/s",
        held.after.angle - held.before.angle,
        SHIP_TURN * 0.5,
        0.03,
      );
    },
  };
}
