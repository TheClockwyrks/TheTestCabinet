// Automated validation for the Spin sub-item `decay`.
//
// Imparted spin decays after the hit — a curved shot straightens within roughly a
// couple of seconds. Spin is imparted by a REAL moving-paddle hit, then the real
// simulation is stepped forward and the spin value it reports back is what decays
// (physics.md: `spin *= 0.5 ^ (dt / 0.8)` per step — half every 0.8 s). We check it
// falls to roughly half after one half-life and to a small fraction after ~2 s,
// without changing sign.
//
// The decay is measured on a ball IN FLIGHT (speed > 0), the only state real play
// ever has — never a parked, zero-velocity ball, which a build would never actually
// reach in a rally. To read the decaying spin without the strongly curving shot
// leaving the field, the paddles are cleared (so no further hit changes spin) and
// the ball's POSITION is re-centered between steps while its velocity and spin carry
// through untouched — the spin decays purely from the elapsed simulation time.

import { hitLeftPaddle, startPlaying, clearPaddles } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("spin.decay");

  await startPlaying(api);

  // Impart real spin with a downward-moving paddle.
  const hit = await hitLeftPaddle(api, { cy: 340, vy: 720, ballY: 360 });
  const spin0 = hit.ball.spin;

  // Step the real sim while the ball stays in flight, re-centering its position each
  // chunk (velocity and spin preserved) so the curving shot cannot leave the field
  // before its spin is read.
  await clearPaddles(api);
  const flyFor = async (seconds) => {
    const chunk = 0.1;
    for (let t = 0; t < seconds - 1e-9; t += chunk) {
      await api.step(Math.min(chunk, seconds - t));
      await api.call("setBall", 0, { x: 640, y: 360 }); // recenter; keep vx/vy/spin
    }
  };

  await flyFor(0.8); // one half-life
  const halfLife = (await api.snapshot()).balls[0].spin;

  await flyFor(1.2); // ~2 s total since the hit
  const settled = (await api.snapshot()).balls[0].spin;

  check.expectOk("a real hit contacts the paddle", hit.hit);
  check.expectGt("a real hit imparts spin to decay (spin)", spin0, 400);
  check.expectOk(
    "spin keeps its sign as it decays (same sign after one half-life)",
    Math.sign(halfLife) === Math.sign(spin0),
  );
  check.expectGt(
    "spin is still above 40% of its start after one half-life (|spin|)",
    Math.abs(halfLife),
    0.4 * Math.abs(spin0),
  );
  check.expectLt(
    "spin has fallen below 60% of its start after one half-life (|spin|)",
    Math.abs(halfLife),
    0.6 * Math.abs(spin0),
  );
  check.expectLt(
    "spin falls to a small fraction after ~2 s (|spin|)",
    Math.abs(settled),
    0.25 * Math.abs(spin0),
  );

  // A clip: a real curving shot visibly straightening as its spin decays.
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 150, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, { x: 180, y: 360, vx: 470, vy: 0, spin: 720 });
  await api.wait(2000);

  return check.verdict();
}
