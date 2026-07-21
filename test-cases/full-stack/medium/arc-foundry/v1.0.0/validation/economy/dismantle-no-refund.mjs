// Automated validation for economy.dismantle-no-refund: dismantling a structure returns
// nothing — no Charge and no stamp — so the roll cannot be reclaimed and re-rolled.
//
// A candidate is placed (spending a stamp), then dismantled; Charge and the stamp allowance
// must both be unchanged by the dismantle, and the structure removed.
//
// Placing the candidate is the arrange; the DISMANTLE is the behavior under test and is the act.

import { startBuild, placeCandidate, towerAt, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows the HUD the assertions read. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The candidate to dismantle, and the HUD either side of the dismantle.
  let candId;
  let s1;
  let s2;

  return {
    id: "economy.dismantle-no-refund",

    async arrange(api) {
      await startBuild(api);
      const cand = await placeCandidate(api, "capacitor", 1, 6, 7);
      candId = cand.id;
    },

    async act(api) {
      s1 = await snap(api);

      await api.call("dismantle", candId);
      s2 = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("hud");
    },

    async assert(api, check) {
      check.expectEq("dismantle returns no Charge", s2.charge, s1.charge);
      check.expectEq("dismantle returns no stamp (the roll is spent for good)", s2.stampsLeft, s1.stampsLeft);
      check.expectEq("the structure was removed", towerAt(s2, 6, 7), null);
    },
  };
}
