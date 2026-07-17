// Automated validation for the `spin-decay` review item.
//
// Imparted spin decays after the hit — a curved shot straightens within roughly a
// couple of seconds. Spin is imparted by a REAL moving-paddle hit, then the ball
// is parked (velocity zeroed — a precondition that isolates the decay from
// flight/collisions) while the real simulation is stepped forward; the spin value
// it reports back is what decays (physics.md: `spin *= 0.5 ^ (dt / 0.8)` per
// step — half every 0.8 s). We check it falls to roughly half after one half-life
// and to a small fraction after ~2 s, without changing sign.

import { hitLeftPaddle, startPlaying } from "./_helpers.mjs";

export default async function drive(api) {
  await startPlaying(api);

  // Impart real spin with a downward-moving paddle.
  const hit = await hitLeftPaddle(api, { cy: 340, vy: 720, ballY: 360 });
  const spin0 = hit.ball.spin;

  // Park the ball (keep its spin, zero its velocity) so only decay changes spin.
  await api.call("setBall", 0, { x: 640, y: 360, vx: 0, vy: 0 });

  await api.step(0.8); // one half-life
  const halfLife = (await api.snapshot()).balls[0].spin;

  await api.step(1.2); // ~2 s total since parking
  const settled = (await api.snapshot()).balls[0].spin;

  const pass =
    hit.hit &&
    spin0 > 400 &&
    Math.sign(halfLife) === Math.sign(spin0) &&
    Math.abs(halfLife) > 0.4 * Math.abs(spin0) &&
    Math.abs(halfLife) < 0.6 * Math.abs(spin0) &&
    Math.abs(settled) < 0.25 * Math.abs(spin0);

  // A clip: a real curving shot visibly straightening as its spin decays.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 150, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, { x: 180, y: 360, vx: 470, vy: 0, spin: 720 });
  await api.wait(2000);

  return {
    verdicts: { "spin-decay": pass },
    notes: {
      "spin-decay": `spin ${spin0.toFixed(0)} -> ${halfLife.toFixed(0)} at 0.8s (~half) -> ${settled.toFixed(0)} at ~2s (${((Math.abs(settled) / Math.abs(spin0)) * 100).toFixed(0)}% of start)`,
    },
  };
}
