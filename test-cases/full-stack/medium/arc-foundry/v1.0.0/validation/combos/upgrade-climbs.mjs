// Automated validation for combos.upgrade-climbs: UPGRADE raises a combination tower's level
// (up to 3) for Charge, scaling its damage and range up.

import { assembleCombo, towerById, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("combos.upgrade-climbs");

  const { comboId } = await assembleCombo(api, "fusecluster", { seed: 1, charge: 400 });
  let s = await snap(api);
  const c0 = towerById(s, comboId);
  const dmg0 = c0.damage;
  const range0 = c0.range;

  await api.call("setCharge", 9999);
  await api.call("upgradeCombo", comboId);
  s = await snap(api);
  const c1 = towerById(s, comboId);

  check.expectEq("upgrading raised the combo's level", c1.level, 1);
  check.expectGt("...scaling its damage up", c1.damage, dmg0);
  check.expectGe("...and not decreasing its range", c1.range, range0);

  await liveClip(api);
  return check.verdict();
}
