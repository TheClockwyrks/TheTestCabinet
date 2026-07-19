// Automated validation for the Flight item `thrust-accelerates`: thrust accelerates
// the ship along its facing (~480 px/s^2). The ship is posed at rest facing +x on an
// empty field; the real thrust key is held while the real sim is stepped and the
// resulting velocity is read back — a stationary ship cannot gain speed on its own.

import { newGame, poseShip, holdStep, liveHold, speedOf } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flight.thrust-accelerates");

  await newGame(api);
  await poseShip(api, { x: 200, y: 200, vx: 0, vy: 0, angle: 0 });
  const { after } = await holdStep(api, "ArrowUp", 0.25);

  check.expectGt("thrust builds real speed from rest", speedOf(after), 90);
  check.expectLt("in a quarter second the speed is a deterministic ~116 px/s", speedOf(after), 145);
  check.expectGt("acceleration is along the facing (+x)", after.vx, 90);
  check.expectClose("thrust along +x adds no sideways velocity", after.vy, 0, 1e-6);
  check.expectOk("the ship reports it is thrusting", after.thrusting === true);

  await poseShip(api, { x: 200, y: 200, vx: 0, vy: 0, angle: 0 });
  await liveHold(api, "ArrowUp", 900);
  return check.verdict();
}
