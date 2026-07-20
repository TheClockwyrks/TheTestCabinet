// Automated validation for quality.range-and-firerate: range nudges up a little per tier
// (about 8 px per rung) while fire rate is flat across quality.
//
// One capacitor candidate is placed at each tier; each candidate's derived range must equal
// base + 8*(tier-1), and its fire rate must be the flat base value for every tier.

import { startBuild, placeCandidate, SPOTS, BASE, RANGE_PER_TIER, towerAt, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("quality.range-and-firerate");

  await startBuild(api);
  for (let tier = 1; tier <= 5; tier += 1) {
    await placeCandidate(api, "capacitor", tier, SPOTS[tier - 1].col, SPOTS[tier - 1].row);
  }
  const s = await snap(api);
  for (let tier = 1; tier <= 5; tier += 1) {
    const t = towerAt(s, SPOTS[tier - 1].col, SPOTS[tier - 1].row);
    check.expectEq(`capacitor T${tier} range (base + 8/tier)`, t.range, BASE.capacitor.range + RANGE_PER_TIER * (tier - 1));
    check.expectClose(`capacitor T${tier} fire rate is flat`, t.fireRate, BASE.capacitor.fireRate, 1e-6);
  }

  await api.screenshot("rangerate");
  return check.verdict();
}
