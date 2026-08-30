// Automated validation for refinement.odds-table: the reported quality-roll odds at each
// Refinement level match the pinned distribution (R0 is 100% Scrap; each rung shifts weight
// upward), summing to 1.
//
// Only opening the run is arranged; stepping the press through the three Refinement levels and
// reading the odds it reports is the behavior under test, so it is the act.
//
// ONE STILL PER LEVEL THE CHECK READS. This used to capture a single frame, taken after the sweep
// had already walked R0 → R4 → R8, so the evidence was the press at R8 and nothing else. The
// claim is that the distribution SHIFTS — that each rung moves weight upward — which is a
// comparison across the three levels, and a picture of the last one cannot make it: a reviewer
// looking at R8's odds has no way to see what R0's or R4's were, and the two assertions about
// them are unevidenced. So each level is captured as it is read, and the three stills carry the
// same three readings the assertions do.

import { startBuild, QUALITY_ODDS_BY_R, snap } from "../_helpers.mjs";

// The Refinement levels the item reads, and the output each one's still lands in.
const RUNGS = [
  { r: 0, output: "odds-r0" },
  { r: 4, output: "odds-r4" },
  { r: 8, output: "odds-r8" },
];
// A real pause so the build's own frame loop paints the new odds before each still is taken. The
// scrap-press panel is PAINTED, and instant stepping paints nothing — the same reason `readPanel`
// waits rather than steps.
const PAINT_MS = 250;

export default function item() {
  // The odds the press reported at each level, read by `assert`.
  const reported = {};

  return {
    id: "refinement.odds-table",

    async arrange(api) {
      await startBuild(api);
    },

    async act(api) {
      for (const { r, output } of RUNGS) {
        await api.call("setRefinement", r);
        reported[r] = (await snap(api)).qualityOdds;
        await api.settle(PAINT_MS);
        await api.screenshot(output);
      }
    },

    async assert(api, check) {
      for (const { r } of RUNGS) {
        const odds = reported[r];
        const exp = QUALITY_ODDS_BY_R[r];
        for (let i = 0; i < 5; i += 1) {
          check.expectClose(`R${r} quality-roll odds for T${i + 1}`, odds[i], exp[i], 1e-6);
        }
        const sum = odds.reduce((a, b) => a + b, 0);
        check.expectClose(`R${r} odds sum to 1`, sum, 1, 1e-6);
      }
    },
  };
}
