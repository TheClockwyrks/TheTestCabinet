// Automated validation for refinement.cost-and-cap: each Refinement level costs the pinned
// Charge amount, is refused when unaffordable, and is disabled at the R8 apex.
//
// Only opening the run with exactly one level's worth of Charge is arranged; the three
// purchases — one affordable, one refused, one at the cap — are the behavior under test and are
// the act.

import { startBuild, REFINE_COST, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows the press at its cap. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The press at each stage, read by `assert`.
  let s0;
  let s1;
  let unaffordable;
  let capped;

  return {
    id: "refinement.cost-and-cap",

    async arrange(api) {
      s0 = await startBuild(api, { charge: 20 });
    },

    async act(api) {
      await api.call("upgradeQuality"); // costs REFINE_COST[1] = 20
      s1 = await snap(api);

      // Now unaffordable (Charge 0, next cost 50).
      await api.call("upgradeQuality");
      unaffordable = (await snap(api)).refinement;

      // Capped at R8.
      await api.call("setRefinement", 8);
      await api.call("setCharge", 9999);
      await api.call("upgradeQuality");
      capped = (await snap(api)).refinement;

      await api.advance(SETTLE_TICKS);
      await api.screenshot("cost");
    },

    async assert(api, check) {
      check.expectEq("the press starts at R0", s0.refinement, 0);
      check.expectEq("buying the next level raised Refinement to R1", s1.refinement, 1);
      check.expectEq("...and spent the pinned cost (20)", s0.charge - s1.charge, REFINE_COST[1]);
      check.expectEq("an unaffordable refine is refused", unaffordable, 1);
      check.expectEq("Refinement is capped at the R8 apex", capped, 8);
    },
  };
}
