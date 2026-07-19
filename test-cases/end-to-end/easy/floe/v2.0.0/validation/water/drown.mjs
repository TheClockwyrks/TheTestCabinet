// Automated validation for the Water band item `drown`.
//
// Standing on a water tile with no floe under it is death. A water lane is cleared
// to open water and the critter is placed on it; the footing reads "water" before
// the step, and the real simulation drowns it on the next step. See
// validation/_helpers.mjs.

import { startCrossing, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("water.drown");

  await startCrossing(api);
  await api.call("setLives", 3);
  await api.call("setLane", 5, { cols: [] }); // open water, no floe
  await api.call("placeCritter", 20, 5);
  check.expectEq("footing over open water reads 'water'", (await api.snapshot()).critter.footing, "water");

  const r = await stepUntil(api, (s) => s.phase === "dying", 1);
  check.expectOk("standing on open water drowns the critter", r.hit);
  check.expectEq("a life is lost to drowning", r.snap.lives, 2);

  // Clip: the critter drowning in real time.
  await startCrossing(api);
  await api.call("setLane", 5, { cols: [] });
  await api.call("placeCritter", 20, 5);
  await api.wait(800);

  return check.verdict();
}
