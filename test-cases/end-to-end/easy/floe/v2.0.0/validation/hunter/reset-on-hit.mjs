// Automated validation for the Hunter item `reset-on-hit`.
//
// A vehicle sliding into the bear resets it (removed from the strait), and it
// re-emerges from the near shore after a delay — not permanently gone, not merely
// staggered. A bear is placed on an ice tile and a plow set sweeping into it; the
// real collision removes it, and once the (advanced) critter is still up top it
// re-emerges. See validation/_helpers.mjs.

import { startCrossing, stepUntil, WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hunter.reset-on-hit");

  await startCrossing(api);
  await api.call("setLane", WATER_TOP, { cols: [20], speed: 0 }); // floe -> the critter has a safe target up top
  await api.call("placeCritter", 20, WATER_TOP);
  await api.call("setLane", 13, { cols: [] }); // clear the bear's lane so only the sweeping plow (below) resets it
  await api.call("setBear", 0, { col: 20, row: 13 });
  check.expectEq("bear present before the hit", (await api.snapshot()).bears[0].present, true);

  await api.call("setLane", 13, { cols: [23], speed: 12, dir: -1 }); // plow sweeping into the bear
  const r = await stepUntil(api, (s) => !s.bears[0].present, 1.5);
  check.expectOk("a vehicle sweeping into the bear resets it (removed)", r.hit);
  check.expectEq("the bear is gone after the hit", r.snap.bears[0].present, false);

  const r2 = await stepUntil(api, (s) => s.bears[0].present, 1.5, 0.05);
  check.expectOk("the bear re-emerges (the hunt returns, not permanently gone)", r2.hit);

  // Clip: the bear reset by the plow, then returning, in real time.
  await startCrossing(api);
  await api.call("setLane", WATER_TOP, { cols: [20], speed: 0 });
  await api.call("placeCritter", 20, WATER_TOP);
  await api.call("setLane", 13, { cols: [] });
  await api.call("setBear", 0, { col: 20, row: 13 });
  await api.call("setLane", 13, { cols: [23], speed: 12, dir: -1 });
  await api.wait(2500);

  return check.verdict();
}
