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
// the ball's POSITION is re-centered between chunks while its velocity and spin carry
// through untouched — the spin decays purely from the elapsed simulation time.

import {
  actLeftPaddleHit,
  arrangeLeftPaddleHit,
  clearPaddles,
  startPlaying,
  ball0,
} from "../_helpers.mjs";

// One half-life, and the further flight that takes the total to ~2 s since the hit.
// Both are whole multiples of the recentering chunk below, so no chunk is ragged —
// in seconds the old loop's final chunk was a float remainder, in ticks it divides
// exactly.
const HALF_LIFE = 96; // 96 ticks = 0.8 s, the spec's spin half-life
const TO_TWO_SECONDS = 144; // 144 ticks = 1.2 s more, ~2 s total since the hit
const RECENTER_CHUNK = 12; // 12 ticks = the old 0.1 s chunk between recenterings

export default function item() {
  // What `act` read off the real simulation, for `assert` to score.
  let hit;
  let spin0;
  let halfLife;
  let settled;

  return {
    id: "spin.decay",

    // Impart real spin with a downward-moving paddle. The contact itself is driven
    // in `act`; here only the paddle's pose and motion and the ball's approach.
    async arrange(api) {
      await startPlaying(api);
      await arrangeLeftPaddleHit(api, { cy: 340, vy: 720, ballY: 360 });
    },

    async act(api) {
      hit = await actLeftPaddleHit(api);
      spin0 = hit.ball.spin;

      // Run the real sim while the ball stays in flight, re-centering its position
      // each chunk (velocity and spin preserved) so the curving shot cannot leave the
      // field before its spin is read. This drive IS the clip: the recorded video
      // shows the shot curving away and being set back to center every chunk, which
      // is precisely the measurement the check makes.
      await clearPaddles(api);
      const flyFor = async (ticks) => {
        for (let t = 0; t < ticks; t += RECENTER_CHUNK) {
          await api.advance(Math.min(RECENTER_CHUNK, ticks - t));
          await api.call("setBall", 0, { x: 640, y: 360 }); // recenter; keep vx/vy/spin
        }
      };

      await flyFor(HALF_LIFE); // one half-life
      halfLife = ball0(await api.snapshot()).spin;

      await flyFor(TO_TWO_SECONDS); // ~2 s total since the hit
      settled = ball0(await api.snapshot()).spin;
    },

    async assert(api, check) {
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
    },
  };
}
