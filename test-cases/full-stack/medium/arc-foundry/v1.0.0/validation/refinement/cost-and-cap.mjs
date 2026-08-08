// Automated validation for refinement.cost-and-cap: each Refinement level costs the pinned
// Charge amount, is refused when unaffordable, and is disabled at the R8 apex.
//
// Only opening the run with exactly one level's worth of Charge is arranged; the three
// purchases — one affordable, one refused, one at the cap — are the behavior under test and are
// the act.
//
// ONE STILL PER STATE THE CHECK READS. This used to capture a single frame at the very end, on a
// press already sitting at its R8 cap with 9999 Charge banked. The claim is that a level COSTS
// something — R0 to R1 for exactly 20 Charge — and a picture taken after two further Refinement
// levels and a Charge override cannot show a price being paid: the reviewer sees a maxed press
// and a Charge total that has nothing to do with the cost the assertion checks.
//
// So the states the assertions read are the states that get captured: the press at R0 with the
// opening reserve and its cost showing, the same press at R1 with that cost spent, and the press
// at the R8 apex with its control disabled. The three stills are the three readings.

import { startBuild, REFINE_COST, snap } from "../_helpers.mjs";

// A real pause so the build's own frame loop paints the scrap-press panel before each still is
// taken. The panel is PAINTED, and instant stepping paints nothing — the same reason `readPanel`
// waits rather than steps.
const PAINT_MS = 250;

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
      // The press as it opens: R0, with exactly one level's worth of Charge and the price of the
      // next rung showing.
      await api.settle(PAINT_MS);
      await api.screenshot("cost-r0");

      await api.call("upgradeQuality"); // costs REFINE_COST[1] = 20
      s1 = await snap(api);
      // The same press one rung up, with that Charge spent.
      await api.settle(PAINT_MS);
      await api.screenshot("cost-r1");

      // Now unaffordable (Charge 0, next cost 50).
      await api.call("upgradeQuality");
      unaffordable = (await snap(api)).refinement;

      // Capped at R8.
      await api.call("setRefinement", 8);
      await api.call("setCharge", 9999);
      await api.call("upgradeQuality");
      capped = (await snap(api)).refinement;
      // The apex: no rung left to buy, however much Charge is banked.
      await api.settle(PAINT_MS);
      await api.screenshot("cost-r8");
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
