// Automated validation for the Rime sub-item `core-immune`.
//
// A Core boss cannot be slowed (specs/surge.md) — a Rime's slow has no effect on it.
// A cold Rime is placed by the lane with a real Core walking through its range; after
// the Rime has fired, the Core reports its full base speed and is not slowed.

import { newGame, build, spawn, unit, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rime.core-immune");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const rime = await build(api, "rime", 3, 18);
  await api.call("setHeat", rime, 0);
  const coreId = await spawn(api, "core", "left");

  // Step long enough that the Rime has certainly fired on the Core in range.
  await api.step(1.5);
  const c = await unit(api, coreId);

  check.expectOk("the Core is on the floor", c !== null);
  check.expectEq("the Core is not slowed by the Rime", c.slowed, false);
  check.expectClose("the Core keeps its full base speed (30 px/s)", c.speed, c.baseSpeed, 0.01);

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const r2 = await build(api, "rime", 3, 18);
  await api.call("setHeat", r2, 0);
  await spawn(api, "core", "left");
  await liveClip(api, 2000);
  return check.verdict();
}
