// Automated validation for the Controls item `rotate-left`: Left arrow rotates the ship
// counter-clockwise. The Left key is held and the real sim stepped; the facing must swing
// CCW at the ~300 deg/s turn rate. Injected input flows through the real key handling.
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
    id: "controls.rotate-left",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 400, y: 360, vx: 0, vy: 0, angle: 0 });
    },

    async act(api) {
      held = await actHoldKey(api, "ArrowLeft", 60);
    },

    async assert(api, check) {
      check.expectClose(
        "Left arrow turns the ship CCW at ~300 deg/s",
        held.after.angle - held.before.angle,
        -SHIP_TURN * 0.5,
        0.03,
      );
    },
  };
}
