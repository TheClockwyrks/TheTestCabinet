// Automated validation for the Economy sub-item `victory`.
//
// Clearing the final round of the campaign with integrity intact wins the game. The
// check runs the final round (round 20) to completion with a large integrity buffer and
// no towers, so it survives every leak; when the final round clears, the real campaign
// resolves to victory.

import { runNoTowerRound, TOTAL_ROUNDS } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.victory");

  const snap = await runNoTowerRound(api, { round: TOTAL_ROUNDS, energy: 0, integrity: 1e9, maxSeconds: 320 });
  check.expectEq("clearing the final round wins the game", snap.screen, "victory");

  await api.wait(200);
  await api.screenshot("victory");
  return check.verdict();
}
