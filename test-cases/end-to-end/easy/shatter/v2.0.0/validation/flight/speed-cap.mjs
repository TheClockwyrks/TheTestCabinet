// Automated validation for the Flight item `speed-cap`: thrust cannot drive the ship
// past its speed cap (~680 px/s). The ship thrusts continuously for several seconds
// while the real sim is stepped; its speed is sampled throughout and must plateau at
// ~680 and never exceed it.

import { newGame, poseShip, speedOf, SHIP_MAX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("flight.speed-cap");

  await newGame(api);
  await poseShip(api, { x: 200, y: 500, vx: 0, vy: 0, angle: 0 });
  await api.call("keyDown", "ArrowUp");

  let maxSpeed = 0;
  for (let i = 0; i < 50; i += 1) {
    await api.step(0.1); // 5 s of continuous thrust
    maxSpeed = Math.max(maxSpeed, speedOf((await api.snapshot()).ship));
  }
  const final = (await api.snapshot()).ship;
  await api.call("keyUp", "ArrowUp");

  check.expectLe("the ship never exceeds the ~680 px/s cap", maxSpeed, SHIP_MAX + 0.5);
  check.expectClose("thrusting flat out, the ship plateaus at the cap", speedOf(final), SHIP_MAX, 1);

  await poseShip(api, { x: 200, y: 500, vx: 0, vy: 0, angle: 0 });
  await api.call("keyDown", "ArrowUp");
  await api.call("setAutoStep", true);
  await api.wait(900);
  await api.call("keyUp", "ArrowUp");
  return check.verdict();
}
