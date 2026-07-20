// Automated validation for the Gravity item `ship-free`: the ship is a powered craft
// and is never pulled by the star. The ship is posed at rest well off the star with no
// keys held; after the real sim steps it must not have moved at all — a body subject to
// gravity would drift toward the star.

import { newGame, poseShip, distToStar, speedOf, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gravity.ship-free");

  await newGame(api);
  await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
  const dBefore = distToStar((await api.snapshot()).ship);

  await api.step(1.0); // a full second under the star's pull, no input
  const after = (await api.snapshot()).ship;

  check.expectClose("the ship at rest is not pulled — it stays put in x", after.x, 300, 0.001);
  check.expectClose("the ship at rest is not pulled — it stays put in y", after.y, 300, 0.001);
  check.expectClose("the ship gains no velocity from gravity", speedOf(after), 0, 0.001);
  check.expectClose("its distance from the star is unchanged", distToStar(after), dBefore, 0.001);

  await liveClip(api, 700);
  return check.verdict();
}
