// Automated validation for economy.placement-free: placing a rock costs no Charge (the
// five-per-level stamp allowance is the only placement limit).
//
// Charge is read before and after a placement; it must be unchanged, while the stamp
// allowance decrements by one.
//
// Only opening the run is arranged; the PLACEMENT is the behavior under test, and a placement
// is a control op, so it is the act and is what the clip shows.

import { startBuild, placeCandidate, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows the HUD the assertions read. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The HUD before and after the placement, read by `assert`.
  let c0;
  let stamps0;
  let s1;

  return {
    id: "economy.placement-free",

    async arrange(api) {
      const s0 = await startBuild(api);
      c0 = s0.charge;
      stamps0 = s0.stampsLeft;
    },

    async act(api) {
      await placeCandidate(api, "capacitor", 1, 6, 7);
      s1 = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("hud");
    },

    async assert(api, check) {
      check.expectEq("placing a rock costs no Charge", s1.charge, c0);
      check.expectEq("placing a rock spends one stamp of the allowance", s1.stampsLeft, stamps0 - 1);
    },
  };
}
