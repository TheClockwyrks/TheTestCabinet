// Automated validation for the Victory-cascade sub-item `launch-cadence`.
//
// Cards launch one at a time on a steady 0.18 s cadence (specs/victory.md). Under
// the manual clock (reset/step put the cascade under the driver's clock), the sim is
// stepped one fixed step at a time and the moment each new card launches is recorded;
// the average gap between successive launches must be ~0.18 s. A short live clip
// then shows the cascade launching.

import { FIXED, LAUNCH_INTERVAL, winBoard } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cascade.launch-cadence");

  await winBoard(api, 5);

  const times = [];
  let prevLaunched = 0;
  let t = 0;
  for (let i = 0; i < 240 && times.length < 8; i += 1) {
    await api.step(FIXED);
    t += FIXED;
    const launched = (await api.snapshot()).cascade.launched;
    if (launched > prevLaunched) {
      times.push(t);
      prevLaunched = launched;
    }
  }

  check.expectGe("several cards launched on cadence", times.length, 8);
  check.expectEq("cards launch one at a time", prevLaunched, times.length);

  // Average the gaps between steady launches (skip the very first, off-phase gap).
  let sum = 0;
  let n = 0;
  for (let k = 2; k < times.length; k += 1) {
    sum += times[k] - times[k - 1];
    n += 1;
  }
  const avgGap = sum / n;
  // The manual clock makes stepping exact, so the discretized cadence sits within
  // one fixed step of the ideal 0.18 s.
  check.expectClose("the launch cadence is ~0.18 s per card", avgGap, LAUNCH_INTERVAL, FIXED * 1.5);

  // A live clip of the steady launching.
  await api.call("setAutoStep", true);
  await api.wait(2500);

  return check.verdict();
}
