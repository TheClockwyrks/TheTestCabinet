// Automated validation for refinement.odds-table: the reported quality-roll odds at each
// Refinement level match the pinned distribution (R0 is 100% Scrap; each rung shifts weight
// upward), summing to 1.

import { startBuild, QUALITY_ODDS_BY_R, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("refinement.odds-table");

  await startBuild(api);
  for (const r of [0, 4, 8]) {
    await api.call("setRefinement", r);
    const odds = (await snap(api)).qualityOdds;
    const exp = QUALITY_ODDS_BY_R[r];
    for (let i = 0; i < 5; i += 1) {
      check.expectClose(`R${r} quality-roll odds for T${i + 1}`, odds[i], exp[i], 1e-6);
    }
    const sum = odds.reduce((a, b) => a + b, 0);
    check.expectClose(`R${r} odds sum to 1`, sum, 1, 1e-6);
  }

  await api.screenshot("odds");
  return check.verdict();
}
