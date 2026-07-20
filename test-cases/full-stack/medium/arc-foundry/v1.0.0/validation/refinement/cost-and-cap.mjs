// Automated validation for refinement.cost-and-cap: each Refinement level costs the pinned
// Charge amount, is refused when unaffordable, and is disabled at the R8 apex.

import { startBuild, REFINE_COST, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("refinement.cost-and-cap");

  const s0 = await startBuild(api, { charge: 20 });
  check.expectEq("the press starts at R0", s0.refinement, 0);

  await api.call("upgradeQuality"); // costs REFINE_COST[1] = 20
  const s1 = await snap(api);
  check.expectEq("buying the next level raised Refinement to R1", s1.refinement, 1);
  check.expectEq("...and spent the pinned cost (20)", s0.charge - s1.charge, REFINE_COST[1]);

  // Now unaffordable (Charge 0, next cost 50).
  await api.call("upgradeQuality");
  check.expectEq("an unaffordable refine is refused", (await snap(api)).refinement, 1);

  // Capped at R8.
  await api.call("setRefinement", 8);
  await api.call("setCharge", 9999);
  await api.call("upgradeQuality");
  check.expectEq("Refinement is capped at the R8 apex", (await snap(api)).refinement, 8);

  await api.screenshot("cost");
  return check.verdict();
}
