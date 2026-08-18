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
//
// The reported scalar falling is only half of what "spin decays" means to a player:
// the FLIGHT has to straighten with it. So the same shot is set down twice in the same
// measuring lane — once while the spin is fresh and once after it has decayed — and how
// far each bends off its line is measured. Both must match what the spin at that moment
// requires, and the late one must be a fraction of the early one.

import {
  actLeftPaddleHit,
  arrangeLeftPaddleHit,
  actCurveOffset,
  assertCurved,
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

// The lane each bend is measured in. The ball is set down at the same point, at the
// same speed, heading the same way for both measurements, so the early and the late
// one differ in nothing but the spin that decayed between them. Starting at x=240
// heading level keeps the whole window clear of the obstacles, the walls and the
// goals, so both are measured over free flight. The window is part of the flight the
// spin decays over, not an addition to it — the two together with the drives between
// them still land the readings at one half-life and at ~2 s.
const MEASURE_X = 240;
const MEASURE_Y = 360;
const MEASURE_TICKS = 48; // 0.4 s — long enough for a fresh spin to bend the flight far

export default function item() {
  // What `act` read off the real simulation, for `assert` to score.
  let hit;
  let spin0;
  let halfLife;
  let settled;
  let earlyBend;
  let lateBend;

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

      // Set the shot down in the measuring lane and fly it free, so how far it bends
      // is read off the same shot both times. Speed is the ball's own — no paddle hit
      // follows, so nothing changes it between the two measurements — and the spin
      // carries through untouched, which is the whole point.
      const measureBend = async () => {
        const b = ball0(await api.snapshot());
        const speed = Math.hypot(b.vx, b.vy);
        await api.call("setBall", 0, {
          x: MEASURE_X,
          y: MEASURE_Y,
          vx: speed,
          vy: 0,
        }); // keep spin
        return actCurveOffset(api, MEASURE_TICKS);
      };

      earlyBend = await measureBend(); // the fresh spin, bending hard
      await flyFor(HALF_LIFE - MEASURE_TICKS); // to one half-life since the hit
      halfLife = ball0(await api.snapshot()).spin;

      await flyFor(TO_TWO_SECONDS - MEASURE_TICKS);
      lateBend = await measureBend(); // the decayed spin, barely bending
      settled = ball0(await api.snapshot()).spin; // ~2 s total since the hit
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
      // The flight has to straighten with the number. Each bend must match the spin
      // the ball carried through it...
      assertCurved(check, earlyBend, { who: "the shot while its spin is fresh" });
      assertCurved(check, lateBend, { who: "the same shot once its spin has decayed" });
      // ...and the late one must be a fraction of the early one: the decay leaves
      // about a quarter of the spin by the time the second is measured, so a build
      // whose flight keeps bending as hard as it did at the hit fails here even
      // though its reported spin fell.
      check.expectLt(
        "the decayed shot bends far less than the fresh one did (px off the line)",
        Math.abs(lateBend.offset),
        0.4 * Math.abs(earlyBend.offset),
      );
    },
  };
}
