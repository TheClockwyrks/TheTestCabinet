// Automated validation for quality.damage-scales: a component's damage multiplies
// x1 / x3 / x9 / x40 / x110 over Scrap across the five tiers — quality is the power axis.
//
// One capacitor candidate is placed at each tier; each candidate reports its derived damage,
// which must equal the base (Scrap) damage times the tier multiplier.

import { startBuild, placeCandidate, SPOTS, BASE, QUALITY_MULT, towerAt, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("quality.damage-scales");

  await startBuild(api);
  for (let tier = 1; tier <= 5; tier += 1) {
    await placeCandidate(api, "capacitor", tier, SPOTS[tier - 1].col, SPOTS[tier - 1].row);
  }
  const s = await snap(api);
  for (let tier = 1; tier <= 5; tier += 1) {
    const t = towerAt(s, SPOTS[tier - 1].col, SPOTS[tier - 1].row);
    const expected = Math.round(BASE.capacitor.dmg * QUALITY_MULT[tier]);
    check.expectEq(`capacitor T${tier} damage (x${QUALITY_MULT[tier]} over Scrap)`, t.damage, expected);
  }

  await api.screenshot("damage");
  return check.verdict();
}
