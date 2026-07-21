// Automated validation for the Economy sub-item `round-clear-bonus`.
//
// Clearing a round pays a fixed clear bonus of 100 plus the round number — the bulk of
// the early economy, since the opening rounds field too little matter to fund a board on
// damage alone. The check runs a whole round with NO towers (so nothing is damaged and
// nothing is paid for damage, keeping the bank clean) from an empty bank, then reads the
// bank when the round resolves back to the build phase.
//
// The between-round phase pays interest on the bank at its start, immediately after the
// clear bonus lands, so the expected bank is the bonus plus the interest that bonus
// itself earns. Two different rounds are cleared, so the `+ 1 × round` term is pinned
// rather than absorbed into a constant.
//
// TWO rounds: the first is arranged, the second posed inside `act` with
// `poseNoTowerRound` (no `reset`, which would freeze the recording).

import {
  arrangeNoTowerRound,
  actNoTowerRound,
  poseNoTowerRound,
  roundClearBonus,
  interestOn,
} from "../_helpers.mjs";

const MAX_CLEAR_TICKS = 24000; // 24000 ticks = the old 400 s cap — round 20 is a long wave

export default function item() {
  let first;
  let later;

  return {
    id: "economy.round-clear-bonus",

    async arrange(api) {
      await arrangeNoTowerRound(api, { round: 1, energy: 0 });
    },

    // Round 1 cleared, then round 20 cleared, each from an empty bank.
    async act(api) {
      first = await actNoTowerRound(api, { max: MAX_CLEAR_TICKS });

      await poseNoTowerRound(api, { round: 20, energy: 0 });
      later = await actNoTowerRound(api, { max: MAX_CLEAR_TICKS });
    },

    async assert(api, check) {
      check.expectEq(
        "the round resolved back to the build phase",
        first.phase,
        "build",
      );
      check.expectEq(
        "clearing round 1 pays 100 + 1 (then interest on it)",
        first.energy,
        roundClearBonus(1) + interestOn(roundClearBonus(1)),
      );

      check.expectEq(
        "clearing round 20 pays 100 + 20 (then interest on it)",
        later.energy,
        roundClearBonus(20) + interestOn(roundClearBonus(20)),
      );
      check.expectGt(
        "a later round's clear bonus is the larger one",
        later.energy,
        first.energy,
      );
    },
  };
}
