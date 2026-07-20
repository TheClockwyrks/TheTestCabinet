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

import { runNoTowerRound, roundClearBonus, interestOn, liveClip } from "../_helpers.mjs";

async function bankAfterClearing(api, round) {
  const snap = await runNoTowerRound(api, { round, energy: 0, maxSeconds: 400 });
  return snap;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.round-clear-bonus");

  const first = await bankAfterClearing(api, 1);
  check.expectEq("the round resolved back to the build phase", first.phase, "build");
  check.expectEq(
    "clearing round 1 pays 100 + 1 (then interest on it)",
    first.energy,
    roundClearBonus(1) + interestOn(roundClearBonus(1)),
  );

  const later = await bankAfterClearing(api, 20);
  check.expectEq(
    "clearing round 20 pays 100 + 20 (then interest on it)",
    later.energy,
    roundClearBonus(20) + interestOn(roundClearBonus(20)),
  );
  check.expectGt("a later round's clear bonus is the larger one", later.energy, first.energy);

  await liveClip(api, 800);
  return check.verdict();
}
