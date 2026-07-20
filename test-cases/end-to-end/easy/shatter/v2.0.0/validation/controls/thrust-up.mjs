// Automated validation for the Controls item `thrust-up`: Up arrow thrusts the ship. Up is
// held while the ship faces +x and the real sim is stepped; the ship must build real speed
// along its facing and report that it is thrusting.

import { newGame, poseShip, holdStep, liveHold, speedOf } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.thrust-up");

  await newGame(api);
  await poseShip(api, { x: 300, y: 360, vx: 0, vy: 0, angle: 0 });
  const { after } = await holdStep(api, "ArrowUp", 0.3);

  check.expectGt("Up arrow thrusts the ship (real speed builds from rest)", speedOf(after), 80);
  check.expectGt("the thrust drives it along its facing (+x)", after.vx, 80);
  check.expectOk("the ship reports it is thrusting", after.thrusting === true);

  await poseShip(api, { x: 300, y: 360, vx: 0, vy: 0, angle: 0 });
  await liveHold(api, "ArrowUp", 900);
  return check.verdict();
}
