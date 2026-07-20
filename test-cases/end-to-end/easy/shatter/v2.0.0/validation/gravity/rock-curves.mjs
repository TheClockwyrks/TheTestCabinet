// Automated validation for the Gravity item `rock-curves`: a rock travels on a curved
// path because the star pulls it. A real rock is placed above and to the left of the star
// drifting purely horizontally; after the real sim steps, gravity must have given it
// velocity toward the star (downward), so it curves rather than moving in a straight line.

import { newGame, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gravity.rock-curves");

  await newGame(api);
  await api.call("addRock", "small", { x: 440, y: 300, vx: 200, vy: 0 });
  const before = (await api.snapshot()).rocks[0];
  check.expectClose("the rock starts drifting with no vertical velocity", before.vy, 0, 1e-6);

  await api.step(0.5);
  const after = (await api.snapshot()).rocks[0];
  check.expectOk("the rock is still on the field", Boolean(after));
  check.expectGt("gravity curved the rock's path toward the star (gained downward velocity)", after.vy, 15);

  await newGame(api);
  await api.call("addRock", "small", { x: 440, y: 300, vx: 200, vy: 0 });
  await liveClip(api, 900);
  return check.verdict();
}
