// Automated validation for the Controls item `rotate-d`: the D key rotates the ship
// clockwise (the alternate rotate binding). D is held and the real sim stepped; the facing
// must swing CW at the ~300 deg/s turn rate.

import { newGame, poseShip, holdStep, liveHold, SHIP_TURN } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.rotate-d");

  await newGame(api);
  await poseShip(api, { x: 400, y: 360, vx: 0, vy: 0, angle: 0 });
  const { before, after } = await holdStep(api, "KeyD", 0.5);

  check.expectClose("D turns the ship CW at ~300 deg/s", after.angle - before.angle, SHIP_TURN * 0.5, 0.03);

  await poseShip(api, { x: 400, y: 360, vx: 0, vy: 0, angle: 0 });
  await liveHold(api, "KeyD", 900);
  return check.verdict();
}
