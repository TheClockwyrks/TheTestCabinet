// Automated validation for the Economy sub-item `interest`.
//
// Between rounds, banked energy earns interest (a percentage of the bank), capped at a
// maximum. The check clears a round (no towers, so no bounties muddy the bank) from two
// starting banks and isolates the interest paid at the clear: the small bank earns a
// little, the large bank earns the cap, and more is earned on more.

import { runNoTowerRound, roundClearBonus, INTEREST_CAP, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.interest");

  const cb = roundClearBonus(1);
  const low = await runNoTowerRound(api, { round: 1, energy: 0 });
  const high = await runNoTowerRound(api, { round: 1, energy: 1000 });
  const interestLow = low.energy - (0 + cb);
  const interestHigh = high.energy - (1000 + cb);

  check.expectGe("a small bank earns a little interest", interestLow, 1);
  check.expectEq("a large bank earns the capped interest", interestHigh, INTEREST_CAP);
  check.expectGt("a larger bank earns more interest", interestHigh, interestLow);

  await liveClip(api, 800);
  return check.verdict();
}
