// Automated validation for refinement.top-tiers-gated: the press never rolls Primed (T4)
// below R4 nor Tesla-Prime (T5) below R8 — a single press roll never exceeds Charged until
// the press is deeply refined.

import { startBuild, snap } from "../_helpers.mjs";

async function odds(api, r) {
  await api.call("setRefinement", r);
  return (await snap(api)).qualityOdds;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("refinement.top-tiers-gated");

  await startBuild(api);
  check.expectEq("Primed (T4) cannot roll below R4", (await odds(api, 3))[3], 0);
  check.expectGt("Primed (T4) can roll at R4", (await odds(api, 4))[3], 0);
  check.expectEq("Tesla-Prime (T5) cannot roll below R8", (await odds(api, 7))[4], 0);
  check.expectGt("Tesla-Prime (T5) can roll at R8", (await odds(api, 8))[4], 0);

  await api.screenshot("gated");
  return check.verdict();
}
