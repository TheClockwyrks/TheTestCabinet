// Automated validation for the Paddles sub-item `rally-caps`.
//
// The per-hit speed-up stops at a ceiling (physics.md:
// `speed = min(speed * 1.04, 980)`), so however long a rally runs the ball plateaus
// at 980 px/s and never exceeds it. This drives a REAL straight rally (see
// `rallySpeeds`), long enough to reach the ceiling, and confirms the peak speed is at
// the cap and the final speed has settled there. The gradual acceleration below the
// cap is the sibling `rally-accelerates` check.

import {
  asserter,
  rallySpeeds,
  startPlaying,
  SPEED_CAP,
} from "../_helpers.mjs";

export default async function drive(api) {
  const rec = asserter();

  const speeds = await rallySpeeds(api);
  const peak = Math.max(...speeds);
  const last = speeds[speeds.length - 1] ?? 0;

  rec.check(
    `the ball's speed never exceeds the ${SPEED_CAP} ceiling (peak ${peak.toFixed(0)})`,
    speeds.length >= 12 && peak <= SPEED_CAP + 1,
  );
  rec.check(
    `the rally plateaus at the ${SPEED_CAP} ceiling (final ${last.toFixed(0)})`,
    Math.abs(last - SPEED_CAP) < 1,
  );

  // A clip: the rally reaching the ceiling and holding there.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 360, vy: 0 });
  await api.call("setBall", 0, { x: 640, y: 360, vx: -520, vy: 0, spin: 0 });
  await api.wait(3200);

  return { verdicts: { "paddles.rally-caps": rec.assertions } };
}
