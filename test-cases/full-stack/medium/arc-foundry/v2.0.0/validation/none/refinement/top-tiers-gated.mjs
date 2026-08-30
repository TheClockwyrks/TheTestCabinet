// Automated validation for refinement.top-tiers-gated: the press never rolls Primed (T4)
// below R4 nor Tesla-Prime (T5) below R8 — a single press roll never exceeds Charged until
// the press is deeply refined.
//
// Only opening the run is arranged; walking the press across each gate and reading the odds
// either side is the behavior under test, so it is the act.
//
// ONE STILL PER GATE. This used to capture a single frame at the end of the sweep, on the press at
// R8 — so the Primed gate, which is the whole of the first half of the claim, had no evidence at
// all. The two stills are the two rungs the gates OPEN at: R4, where Primed first carries weight
// and Tesla-Prime still carries none, and R8, where Tesla-Prime finally does. Between them a
// reviewer can see both gates in the odds the press itself reports.

import { startBuild, snap } from "../_helpers.mjs";

// A real pause so the build's own frame loop paints the new odds before each still is taken. The
// scrap-press panel is PAINTED, and instant stepping paints nothing.
const PAINT_MS = 250;

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
      // R4: Primed has just started to roll, and Tesla-Prime still cannot.
      await api.settle(PAINT_MS);
      await api.screenshot("gated-r4");

      belowTesla = await odds(api, 7);
      atTesla = await odds(api, 8);
      // R8: the apex, where Tesla-Prime finally carries weight.
      await api.settle(PAINT_MS);
      await api.screenshot("gated-r8");
    },

    async assert(api, check) {
      check.expectEq("Primed (T4) cannot roll below R4", belowPrimed[3], 0);
      check.expectGt("Primed (T4) can roll at R4", atPrimed[3], 0);
      check.expectEq("Tesla-Prime (T5) cannot roll below R8", belowTesla[4], 0);
      check.expectGt("Tesla-Prime (T5) can roll at R8", atTesla[4], 0);
    },
  };
}
