// Automated validation for refinement.odds-table: the reported quality-roll odds at each
// Refinement level match the pinned distribution (R0 is 100% Scrap; each rung shifts weight
// upward), summing to 1.
//
// Only opening the run is arranged; stepping the press through the three Refinement levels and
// reading the odds it reports is the behavior under test, so it is the act — and the clip shows
// the odds display shifting weight upward rung by rung.

import { startBuild, QUALITY_ODDS_BY_R, snap } from "../_helpers.mjs";

// A frame for the still, and enough of one between rungs that the shifting odds are legible.
// 100 ms x 60 Hz = 6 ticks exactly.
const SETTLE_TICKS = 6;

export default function item() {
  // The odds the press reported at each level, read by `assert`.
  const reported = {};

  return {
    id: "refinement.odds-table",

    async arrange(api) {
      await startBuild(api);
    },

    async act(api) {
      for (const r of [0, 4, 8]) {
        await api.call("setRefinement", r);
        reported[r] = (await snap(api)).qualityOdds;
        await api.advance(SETTLE_TICKS);
      }

      await api.screenshot("odds");
    },

    async assert(api, check) {
      for (const r of [0, 4, 8]) {
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
