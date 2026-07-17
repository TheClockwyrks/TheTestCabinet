// Automated validation for the Paddles sub-item `rally` (rally acceleration).
//
// A normal paddle hit speeds the ball up only slightly (physics.md:
// `speed = min(speed * 1.04, 980)`), so rallies accelerate gradually over several
// hits and stop getting faster once they reach the ceiling. This drives a REAL
// straight rally between two stationary, centered paddles (a center hit returns
// the ball level, so it bounces cleanly back and forth clear of the obstacles) and
// records the ball's speed after each successive real paddle hit, then checks the
// per-hit ratio is ~1.04 below the cap, the sequence is non-decreasing, and it
// plateaus at 980.

import { startPlaying } from "../_helpers.mjs";

const SPEED_CAP = 980;
const SPEED_MULT = 1.04;

export default async function drive(api) {
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 360, vy: 0 });
  await api.call("setBall", 0, { x: 640, y: 360, vx: -500, vy: 0, spin: 0 });

  // Record the ball's speed after each paddle hit (a hit flips vx's sign).
  const speeds = [];
  let prevSign = -1; // ball starts moving left, toward the left paddle
  for (let hit = 0; hit < 24; hit += 1) {
    let snap = await api.snapshot();
    if (Math.sign(snap.balls[0].vx) !== prevSign)
      prevSign = Math.sign(snap.balls[0].vx);
    // Step (coarsely — speed is constant between hits) until vx reverses.
    let reversed = false;
    for (let i = 0; i < 100 && !reversed; i += 1) {
      await api.step(0.05);
      snap = await api.snapshot();
      if (snap.screen !== "playing") break;
      if (Math.sign(snap.balls[0].vx) === -prevSign && snap.balls[0].vx !== 0)
        reversed = true;
    }
    if (!reversed) break;
    speeds.push(snap.balls[0].speed);
    prevSign = -prevSign;
  }

  // Ratios between consecutive post-hit speeds should be ~1.04 while below the cap.
  let ratiosOk = speeds.length >= 12;
  let monotonic = true;
  for (let i = 1; i < speeds.length; i += 1) {
    if (speeds[i] < speeds[i - 1] - 0.5) monotonic = false;
    if (speeds[i - 1] < SPEED_CAP / SPEED_MULT - 1) {
      const ratio = speeds[i] / speeds[i - 1];
      if (Math.abs(ratio - SPEED_MULT) > 0.01) ratiosOk = false;
    }
  }
  const peak = Math.max(...speeds);
  const last = speeds[speeds.length - 1] ?? 0;
  const capped = peak <= SPEED_CAP + 1 && Math.abs(last - SPEED_CAP) < 1;

  const pass = ratiosOk && monotonic && capped;

  // A clip: the rally, accelerating hit by hit up to the ceiling.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 360, vy: 0 });
  await api.call("setBall", 0, { x: 640, y: 360, vx: -520, vy: 0, spin: 0 });
  await api.wait(3200);

  return {
    verdicts: { "paddles.rally": pass },
    notes: {
      "paddles.rally": `${speeds.length} hits: ${speeds
        .slice(0, 3)
        .map((s) => s.toFixed(0))
        .join(
          "->",
        )}...->${last.toFixed(0)} (peak ${peak.toFixed(0)}, cap 980); ratio~1.04=${ratiosOk}, monotonic=${monotonic}`,
    },
  };
}
