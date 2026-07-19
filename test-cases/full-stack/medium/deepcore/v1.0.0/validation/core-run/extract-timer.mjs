// Automated validation for core-run.extract-timer.
//
// Extracting the Core Sample banks it in the satchel and starts a 90-second destabilization
// countdown that ticks with time. We extract it and confirm the timer starts near 90 and falls with
// stepped time.

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("core-run.extract-timer");

  await newRun(api);
  await api.call("spawnCoreSample");
  const s0 = await api.snapshot();
  check.expectEq("the Core Sample is now carried", s0.satchel.coreSample, true);
  check.expectClose("the timer starts near 90s", s0.coreTimer, 90, 0.5);

  await api.step(5);
  const s1 = await api.snapshot();
  check.expectClose("the timer counts down with time", s1.coreTimer, 85, 0.5);

  await liveClip(api, 600);
  return check.verdict();
}
