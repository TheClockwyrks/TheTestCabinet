// Automated validation for the Flight item `turn-rate`: turning rotates the facing at
// ~300 deg/s and changes ONLY the facing, not the velocity's direction. The ship is
// posed with a fixed velocity and a rotate key held while the real sim is stepped: the
// facing must swing by ~300 deg/s while the velocity vector keeps its heading (only its
// magnitude decays under the always-on drag, which scales both components equally).

import { newGame, poseShip, SHIP_TURN } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flight.turn-rate");

  await newGame(api);
  await poseShip(api, { x: 400, y: 360, vx: 120, vy: 90, angle: 0 });
  const before = (await api.snapshot()).ship;
  const velDirBefore = Math.atan2(before.vy, before.vx);

  await api.call("keyDown", "ArrowLeft");
  await api.step(0.5); // half a second of turning left (CCW)
  const after = (await api.snapshot()).ship;
  await api.call("keyUp", "ArrowLeft");

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

  await poseShip(api, { x: 400, y: 360, vx: 120, vy: 90, angle: 0 });
  await api.call("keyDown", "ArrowLeft");
  await api.call("setAutoStep", true);
  await api.wait(900);
  await api.call("keyUp", "ArrowLeft");
  return check.verdict();
}
