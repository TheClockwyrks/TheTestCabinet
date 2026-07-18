// Automated validation for the Paddles sub-item `rally-accelerates`.
//
// A normal paddle hit speeds the ball up slightly (physics.md:
// `speed = min(speed * 1.04, 980)`), so a rally accelerates gradually hit by hit.
// This drives a REAL straight rally (see `rallySpeeds`) and confirms the per-hit
// speed ratio is ~1.04 while below the ceiling and that the sequence never decreases.
// The plateau at the ceiling is the sibling `rally-caps` check.

import { rallySpeeds, startPlaying, SPEED_CAP } from "../_helpers.mjs";

const SPEED_MULT = 1.04;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("paddles.rally-accelerates");

  const speeds = await rallySpeeds(api);

  // Ratios between consecutive post-hit speeds should be ~1.04 while below the cap,
  // and the sequence must never decrease hit to hit.
  let ratiosOk = speeds.length >= 12;
  let monotonic = true;
  for (let i = 1; i < speeds.length; i += 1) {
    if (speeds[i] < speeds[i - 1] - 0.5) monotonic = false;
    if (speeds[i - 1] < SPEED_CAP / SPEED_MULT - 1) {
      const ratio = speeds[i] / speeds[i - 1];
      if (Math.abs(ratio - SPEED_MULT) > 0.01) ratiosOk = false;
    }
  }

  check.expectOk("each hit speeds the ball up ~1.04x below the cap", ratiosOk);
  check.expectOk("the rally speed never decreases hit to hit", monotonic);

  // A clip: the rally accelerating hit by hit.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 360, vy: 0 });
  await api.call("setBall", 0, { x: 640, y: 360, vx: -520, vy: 0, spin: 0 });
  await api.wait(3200);

  return check.verdict();
}
