// Automated validation for the Hunter item `routes-around`.
//
// Facing a wall of vehicles across its path, the bear detours sideways to a gap
// and gets past it rather than driving straight into the traffic. A plow wall is
// laid across an ice row directly above the bear, with a gap to the right; the real
// pathfinder routes the bear sideways and then up through the gap, which the
// snapshots read back. See validation/_helpers.mjs.

import { startCrossing, clearIce, stepUntil, WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hunter.routes-around");

  await startCrossing(api);
  await api.call("setLane", WATER_TOP, { cols: [20], speed: 0 }); // floe under the critter up top
  await api.call("placeCritter", 20, WATER_TOP);
  await clearIce(api);
  // A wall across row 17 covering columns ~4..15, leaving a gap on the right.
  await api.call("setLane", 17, { cols: [4, 7, 10, 13], speed: 0 });
  await api.call("setBear", 0, { col: 10, row: 18 }); // straight up is walled

  // It detours sideways toward the gap.
  const r1 = await stepUntil(api, (s) => s.bears[0].present && s.bears[0].col > 10, 2, 0.05);
  check.expectOk("the bear detours sideways rather than into the wall", r1.hit);

  // And it routes past the wall through the gap.
  const r2 = await stepUntil(api, (s) => s.bears[0].present && s.bears[0].row < 17, 5, 0.05);
  check.expectOk("the bear routes around the wall and past it", r2.hit);

  // Clip: the detour in real time.
  await startCrossing(api);
  await api.call("setLane", WATER_TOP, { cols: [20], speed: 0 });
  await api.call("placeCritter", 20, WATER_TOP);
  await clearIce(api);
  await api.call("setLane", 17, { cols: [4, 7, 10, 13], speed: 0 });
  await api.call("setBear", 0, { col: 10, row: 18 });
  await api.wait(3500);

  return check.verdict();
}
