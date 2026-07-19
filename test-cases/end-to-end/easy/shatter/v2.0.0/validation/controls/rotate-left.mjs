// Automated validation for the Controls item `rotate-left`: Left arrow rotates the ship
// counter-clockwise. The Left key is held and the real sim stepped; the facing must swing
// CCW at the ~300 deg/s turn rate. Injected input flows through the real key handling.

import { newGame, poseShip, holdStep, liveHold, SHIP_TURN } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.rotate-left");

  await newGame(api);
  await poseShip(api, { x: 400, y: 360, vx: 0, vy: 0, angle: 0 });
  const { before, after } = await holdStep(api, "ArrowLeft", 0.5);

  check.expectClose("Left arrow turns the ship CCW at ~300 deg/s", after.angle - before.angle, -SHIP_TURN * 0.5, 0.03);

  await poseShip(api, { x: 400, y: 360, vx: 0, vy: 0, angle: 0 });
  await liveHold(api, "ArrowLeft", 900);
  return check.verdict();
}
