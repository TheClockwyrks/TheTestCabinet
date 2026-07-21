// Automated validation for the Flight item `thrust-accelerates`: thrust accelerates
// the ship along its facing (~480 px/s^2). The ship is posed at rest facing +x on an
// empty field; the real thrust key is held while the real sim is stepped and the
// resulting velocity is read back — a stationary ship cannot gain speed on its own.
//
// The ship's pose is the precondition (`arrange`); holding thrust while the real sim runs is
// the behavior under test (`act`), so that quarter-second burn IS the clip — the reviewer sees
// the same acceleration the numbers describe. 0.25 s x 120 Hz = 30 ticks.

import { newGame, poseShip, actHoldKey, speedOf } from "../_helpers.mjs";

export default function item() {
  // The ship after the thrust burn, read by `assert`.
  let after;

  return {
    id: "flight.thrust-accelerates",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 200, y: 200, vx: 0, vy: 0, angle: 0 });
    },

    async act(api) {
      ({ after } = await actHoldKey(api, "ArrowUp", 30));
    },

    async assert(api, check) {
      check.expectGt("thrust builds real speed from rest", speedOf(after), 90);
      check.expectLt(
        "in a quarter second the speed is a deterministic ~116 px/s",
        speedOf(after),
        145,
      );
      check.expectGt("acceleration is along the facing (+x)", after.vx, 90);
      check.expectClose(
        "thrust along +x adds no sideways velocity",
        after.vy,
        0,
        1e-6,
      );
      check.expectOk(
        "the ship reports it is thrusting",
        after.thrusting === true,
      );
    },
  };
}
