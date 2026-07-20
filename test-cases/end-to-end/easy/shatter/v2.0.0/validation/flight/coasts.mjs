// Automated validation for the Flight item `coasts`: releasing thrust leaves the ship
// coasting under momentum with a gentle drag (velocity halves roughly every 3 s), with
// no instant stop and no reverse. The ship is posed moving at 300 px/s with no keys
// held; the real sim is stepped and the velocity read back.

import { newGame, poseShip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flight.coasts");

  await newGame(api);
  await poseShip(api, { x: 200, y: 200, vx: 300, vy: 0, angle: 0 });

  await api.step(0.1);
  const early = (await api.snapshot()).ship;
  check.expectGt("the ship keeps most of its speed a moment later (no instant stop)", early.vx, 250);

  await api.step(2.9); // 3.0 s total of coasting
  const late = (await api.snapshot()).ship;
  check.expectClose("after ~3 s of drag the speed has halved to ~150 px/s", late.vx, 150, 3);
  check.expectGt("the ship never reverses — it coasts forward", late.vx, 0);
  check.expectClose("coasting straight adds no sideways velocity", late.vy, 0, 1e-6);

  await poseShip(api, { x: 200, y: 200, vx: 300, vy: 0, angle: 0 });
  await api.call("setAutoStep", true);
  await api.wait(900);
  return check.verdict();
}
