// Automated validation for economy.placement-free: placing a rock costs no Charge (the
// five-per-level stamp allowance is the only placement limit).
//
// Charge is read before and after a placement; it must be unchanged, while the stamp
// allowance decrements by one.

import { startBuild, placeCandidate, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.placement-free");

  const s0 = await startBuild(api);
  const c0 = s0.charge;
  const stamps0 = s0.stampsLeft;

  await placeCandidate(api, "capacitor", 1, 6, 7);
  const s1 = await snap(api);

  check.expectEq("placing a rock costs no Charge", s1.charge, c0);
  check.expectEq("placing a rock spends one stamp of the allowance", s1.stampsLeft, stamps0 - 1);

  await api.screenshot("hud");
  return check.verdict();
}
