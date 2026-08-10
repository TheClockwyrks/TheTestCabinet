// Automated validation for the Controls item `thrust-w`: the W key thrusts the ship (the
// alternate thrust binding). W is held while the ship faces +x and the real sim is
// stepped; the ship must build real speed along its facing and report thrusting.
//
// The ship's pose is the precondition (`arrange`); holding the key while the real sim runs is
// the behavior under test (`act`), so the hold IS the clip. 0.3 s x 120 Hz = 36 ticks.

import { newGame, poseShip, actHoldKey, speedOf } from "../_helpers.mjs";

export default function item() {
  // The ship after the thrust burn, read by `assert`.
  let after;

  return {
    id: "controls.thrust-w",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 300, y: 360, vx: 0, vy: 0, angle: 0 });
    },

    async act(api) {
      ({ after } = await actHoldKey(api, "KeyW", 36));
    },

    async assert(api, check) {
      check.expectGt(
        "W thrusts the ship (real speed builds from rest)",
        speedOf(after),
        80,
      );
      check.expectGt(
        "the thrust drives it along its facing (+x)",
        after.vx,
        80,
      );
      check.expectOk(
        "the ship reports it is thrusting",
        after.thrusting === true,
      );
    },
  };
}
