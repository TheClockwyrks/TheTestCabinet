// Automated validation for combos.lands-level0: a newly assembled combination tower lands at
// upgrade level 0 (its reduced landing block), so assembling it is a step up, not a cliff.

import { assembleCombo, towerById, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("combos.lands-level0");

  const { comboId } = await assembleCombo(api, "fusecluster", { seed: 1, charge: 400 });
  const c = towerById(await snap(api), comboId);
  check.expectEq("a freshly assembled combo lands at upgrade level 0", c.level, 0);

  await api.screenshot("level0");
  return check.verdict();
}
