// Automated validation for economy.dismantle-no-refund: dismantling a structure returns
// nothing — no Charge and no stamp — so the roll cannot be reclaimed and re-rolled.
//
// A candidate is placed (spending a stamp), then dismantled; Charge and the stamp allowance
// must both be unchanged by the dismantle, and the structure removed.

import { startBuild, placeCandidate, towerAt, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.dismantle-no-refund");

  await startBuild(api);
  const cand = await placeCandidate(api, "capacitor", 1, 6, 7);
  const s1 = await snap(api);
  const charge1 = s1.charge;
  const stamps1 = s1.stampsLeft;

  await api.call("dismantle", cand.id);
  const s2 = await snap(api);

  check.expectEq("dismantle returns no Charge", s2.charge, charge1);
  check.expectEq("dismantle returns no stamp (the roll is spent for good)", s2.stampsLeft, stamps1);
  check.expectEq("the structure was removed", towerAt(s2, 6, 7), null);

  await api.screenshot("hud");
  return check.verdict();
}
