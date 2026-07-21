// Automated validation for the Flight item `turn-rate`: turning rotates the facing at
// ~300 deg/s and changes ONLY the facing, not the velocity's direction. The ship is
// posed with a fixed velocity and a rotate key held while the real sim is stepped: the
// facing must swing by ~300 deg/s while the velocity vector keeps its heading (only its
// magnitude decays under the always-on drag, which scales both components equally).
//
// The ship's pose is the precondition (`arrange`); holding the turn key while the real sim
// runs is the behavior (`act`), so the half-second turn IS the clip — the reviewer sees the
// nose swing round while the ship keeps drifting the way it was already going.
//
// 0.5 s x 120 Hz = 60 ticks. The `* 0.5` in the expected angle stays in SECONDS: SHIP_TURN is
// a rate in rad/s, so the expected swing is rate x half a second.

import { newGame, poseShip, SHIP_TURN } from "../_helpers.mjs";

export default function item() {
  // The ship before and after the turn, plus its velocity heading going in.
  let before;
  let after;
  let velDirBefore;

  return {
    id: "flight.turn-rate",

    async arrange(api) {
      await newGame(api);
      await poseShip(api, { x: 400, y: 360, vx: 120, vy: 90, angle: 0 });
    },

    async act(api) {
      before = (await api.snapshot()).ship;
      velDirBefore = Math.atan2(before.vy, before.vx);

      await api.call("keyDown", "ArrowLeft");
      await api.advance(60); // half a second of turning left (CCW)
      after = (await api.snapshot()).ship;
      await api.call("keyUp", "ArrowLeft");
    },

    async assert(api, check) {
      check.expectClose(
        "the facing turns CCW by ~150 deg in half a second (300 deg/s)",
        after.angle - before.angle,
        -SHIP_TURN * 0.5,
        0.02,
      );
      check.expectClose(
        "turning leaves the velocity's direction unchanged",
        Math.atan2(after.vy, after.vx),
        velDirBefore,
        0.01,
      );
    },
  };
}
