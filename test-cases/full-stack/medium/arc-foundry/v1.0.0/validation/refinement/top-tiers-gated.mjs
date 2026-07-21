// Automated validation for refinement.top-tiers-gated: the press never rolls Primed (T4)
// below R4 nor Tesla-Prime (T5) below R8 — a single press roll never exceeds Charged until
// the press is deeply refined.
//
// Only opening the run is arranged; walking the press across each gate and reading the odds
// either side is the behavior under test, so it is the act.

import { startBuild, snap } from "../_helpers.mjs";

// A frame for the still. 100 ms x 60 Hz = 6 ticks exactly.
const SETTLE_TICKS = 6;

async function odds(api, r) {
  await api.call("setRefinement", r);
  return (await snap(api)).qualityOdds;
}

export default function item() {
  // The odds either side of each gate, read by `assert`.
  let belowPrimed;
  let atPrimed;
  let belowTesla;
  let atTesla;

  return {
    id: "refinement.top-tiers-gated",

    async arrange(api) {
      await startBuild(api);
    },

    async act(api) {
      belowPrimed = await odds(api, 3);
      atPrimed = await odds(api, 4);
      belowTesla = await odds(api, 7);
      atTesla = await odds(api, 8);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("gated");
    },

    async assert(api, check) {
      check.expectEq("Primed (T4) cannot roll below R4", belowPrimed[3], 0);
      check.expectGt("Primed (T4) can roll at R4", atPrimed[3], 0);
      check.expectEq("Tesla-Prime (T5) cannot roll below R8", belowTesla[4], 0);
      check.expectGt("Tesla-Prime (T5) can roll at R8", atTesla[4], 0);
    },
  };
}
