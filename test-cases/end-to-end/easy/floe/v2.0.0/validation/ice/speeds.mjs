// Automated validation for the Ice band item `speeds`.
//
// The base lane speeds sit in a slow range, and each level speeds them up (about
// 1.06x per level). The lane speeds are read at level 1, then the level is
// rebuilt at level 2 and the per-lane ratio confirmed. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ice.speeds");

  await startCrossing(api);
  const l1 = (await api.snapshot()).lanes.ice.map((l) => l.speed);
  for (let i = 0; i < l1.length; i += 1) {
    check.expectGe(`level-1 ice lane ${i} speed is in the slow range`, l1[i], 1.4);
    check.expectLe(`level-1 ice lane ${i} speed is in the slow range`, l1[i], 2.6);
  }

  await api.call("setLevel", 2);
  const l2 = (await api.snapshot()).lanes.ice.map((l) => l.speed);
  for (let i = 0; i < l2.length; i += 1) {
    check.expectClose(`ice lane ${i} speeds up ~1.06x at level 2`, l2[i] / l1[i], 1.06, 0.01);
  }

  await api.wait(120);
  await api.screenshot("scene");

  return check.verdict();
}
