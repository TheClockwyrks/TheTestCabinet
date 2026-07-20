// Automated validation for core-run.detonation-death.
//
// If the countdown reaches zero while carrying the Sample it detonates, killing the miner. We
// extract the Sample and run the real sim past the 90-second timer, confirming the core-detonation
// Game Over.

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("core-run.detonation-death");

  await newRun(api);
  await api.call("spawnCoreSample");
  await api.step(92); // past the 90s timer plus the death animation

  const snap = await api.snapshot();
  check.expectEq("the timer expiry ends the run", snap.screen, "game-over");
  check.expectEq("the death cause is a core detonation", snap.summary ? snap.summary.deathCause : null, "core-detonation");

  await liveClip(api, 700);
  return check.verdict();
}
