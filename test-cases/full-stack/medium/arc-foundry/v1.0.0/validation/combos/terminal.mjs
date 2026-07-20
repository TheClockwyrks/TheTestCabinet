// Automated validation for combos.terminal: a combination tower has no quality tier and cannot
// be quality-combined or fed as an ingredient into another recipe — it is terminal.

import { assembleCombo, towerById, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("combos.terminal");

  const { comboId } = await assembleCombo(api, "fusecluster", { seed: 1, charge: 400 });
  const c = towerById(await snap(api), comboId);
  check.expectEq("a combo has no quality tier", c.quality, null);

  // A combine attempt from the combo does nothing (it is not a base structure).
  await api.call("setCombineSet", []);
  await api.call("combine", comboId);
  const c2 = towerById(await snap(api), comboId);
  check.expectEq("the combo is unchanged by a combine attempt (terminal)", c2.kind, "combo");
  check.expectEq("...still the same combination tower", c2.type, c.type);

  await api.screenshot("terminal");
  return check.verdict();
}
