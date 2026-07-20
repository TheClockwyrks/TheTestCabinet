// Automated validation for the Economy sub-item `early-send-bonus`.
//
// Starting the next round early, during a timed between-round countdown, pays a bonus for
// the whole seconds left on the clock. The check clears round 1 to reach a timed build
// phase, empties the bank, reads the countdown, then sends the next round early — the
// bank holds exactly the whole seconds that were left.

import { runNoTowerRound, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.early-send-bonus");

  const built = await runNoTowerRound(api, { round: 1, energy: 0 });
  check.expectEq("the round resolved to the build phase", built.phase, "build");
  const c = built.buildCountdown;
  check.expectOk("the between-round phase is timed (has a countdown)", c != null && c > 0);

  await api.call("setEnergy", 0);
  await api.call("startRound");
  const after = await api.snapshot();
  check.expectEq("sending early pays a bonus for the whole seconds left", after.energy, Math.floor(c));

  await liveClip(api, 800);
  return check.verdict();
}
