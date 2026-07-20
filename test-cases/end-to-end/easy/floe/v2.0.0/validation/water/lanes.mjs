// Automated validation for the Water band item `lanes`.
//
// The water band is eight lanes (rows 2..9) of drifting floes, in alternating
// directions. Read straight from the snapshot after a fresh crossing. See
// validation/_helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("water.lanes");

  await startCrossing(api);
  const water = (await api.snapshot()).lanes.water;

  check.expectEq("eight water-band lanes", water.length, 8);
  for (let i = 0; i < water.length; i += 1) {
    check.expectEq(`water lane ${i} is at row ${WATER_TOP + i}`, water[i].row, WATER_TOP + i);
    check.expectGt(`water lane ${i} carries floes`, water[i].items.length, 0);
  }
  for (let i = 1; i < water.length; i += 1) {
    check.expectEq(`water lane ${i} runs opposite lane ${i - 1}`, water[i].dir, -water[i - 1].dir);
  }

  await api.wait(120);
  await api.screenshot("scene");

  return check.verdict();
}
