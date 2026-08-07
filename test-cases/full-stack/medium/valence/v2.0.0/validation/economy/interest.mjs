// Automated validation for the Economy sub-item `interest`.
//
// Between rounds, banked energy earns interest (a percentage of the bank), capped at a
// maximum. The check clears a round (no towers, so no bounties muddy the bank) from two
// starting banks and isolates the interest paid at the clear: the small bank earns a
// little, the large bank earns the cap, and more is earned on more.
//
// TWO rounds, so the second is opened with `poseNoTowerRound` — the twin that uses
// control ops alone — because `api.reset` throws inside `act`.

import {
  arrangeNoTowerRound,
  actNoTowerRound,
  poseNoTowerRound,
  clipBudget,
  roundClearBonus,
  INTEREST_CAP,
} from "../_helpers.mjs";

export default function item() {
  let low;
  let high;

  return {
    id: "economy.interest",

    // Two cleared rounds, each filmed from the tail of its wave through the payout.
    clipMs: clipBudget(2 * 1020),

    async arrange(api) {
      await arrangeNoTowerRound(api, { round: 1, energy: 0 });
    },

    // Both cleared rounds, back to back: the empty bank first, then the same round from a
    // bank of 1000.
    async act(api) {
      low = await actNoTowerRound(api);

      await poseNoTowerRound(api, { round: 1, energy: 1000 });
      high = await actNoTowerRound(api);
    },

    async assert(api, check) {
      const cb = roundClearBonus(1);
      const interestLow = low.energy - (0 + cb);
      const interestHigh = high.energy - (1000 + cb);

      check.expectGe("a small bank earns a little interest", interestLow, 1);
      check.expectEq(
        "a large bank earns the capped interest",
        interestHigh,
        INTEREST_CAP,
      );
      check.expectGt(
        "a larger bank earns more interest",
        interestHigh,
        interestLow,
      );
    },
  };
}
