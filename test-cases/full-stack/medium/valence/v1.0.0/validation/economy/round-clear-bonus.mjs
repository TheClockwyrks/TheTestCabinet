// Automated validation for the Economy sub-item `round-clear-bonus`.
//
// Surviving to the end of a round pays a clear bonus over the per-unit bounties. The
// check runs a whole round with NO towers (so every unit leaks and pays no bounty,
// keeping the bank clean) starting from zero energy; when the round resolves back to the
// build phase the bank holds the clear bonus.

import { runNoTowerRound, roundClearBonus, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.round-clear-bonus");

  const snap = await runNoTowerRound(api, { round: 1, energy: 0 });
  check.expectEq("the round resolved back to the build phase", snap.phase, "build");
  check.expectGe("clearing a round pays a bonus (beyond bounties)", snap.energy, roundClearBonus(1));

  await liveClip(api, 800);
  return check.verdict();
}
