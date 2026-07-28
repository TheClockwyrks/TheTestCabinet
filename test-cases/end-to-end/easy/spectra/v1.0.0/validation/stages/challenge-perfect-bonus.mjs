// Automated validation for the Stages sub-item `challenge-perfect-bonus`.
//
// Destroying every drone in a challenge stage scores per drone (100 each, 40 drones)
// plus a large perfect bonus (10000), for 14000 total. A real challenge stage is
// run and every drone destroyed with a matching-band shot as it sweeps across; the
// real scoring and the real perfect-clear path produce the total, read back at the
// stage-cleared screen. (Only a full clear yields 14000; a miss scores less.)

import { startStageClean } from "../_helpers.mjs";

// The old drive loop was 800 iterations of a 0.03 s step — a 24 s window. 0.03 s is
// 3.6 ticks, which the tick contract refuses rather than rounds, so the step rounds
// DOWN to 3: this loop is chasing drones across the screen, and a shorter gap between
// volleys can only catch a drone a longer gap would have let slip past. The iteration
// cap is raised to 960 so the total window stays the original 24 s (960 x 3 ticks)
// rather than shrinking to 20 s with the finer step — the check needs the whole
// stage to have run, or the clear would not be perfect for the wrong reason.
const STEP_TICKS = 3;
const MAX_ITERS = 960;

// A perfect clear is a 24 s rake, and the thing this item is about — the score
// jumping by the 10000 bonus — happens in the last instant of it. Filmed straight
// through, the clip's 8 s budget ran out long before the bonus was paid, so the
// reviewer watched volley after volley and never saw the payoff.
//
// So the rake is stepped INSTANTLY (`api.skip`, exact in both passes and never
// filmed) until the stage is nearly cleared, and only the last group onward is
// advanced in real time. The simulation is identical either way — this changes only
// what the recording contains, never the verdict, which the validate pass decides
// with both calls instant.
//
// The switch is the score: at 100 a drone (`specs/gameplay.md`), this is the point
// where a group's worth of drones is left.
const FILM_FROM_SCORE = 3200;

// Held on the stage-cleared interstitial afterwards, so the perfect bonus is on
// screen long enough to read.
const CLEARED_HOLD_TICKS = 240; // 2 s

export default function item() {
  // The state at the end of the clear.
  let final;

  return {
    id: "stages.challenge-perfect-bonus",

    // A real challenge stage with the wave the game builds, score zeroed so the
    // total read back is attributable entirely to this stage.
    async arrange(api) {
      await startStageClean(api, 3, { clear: false });
      await api.call("setScore", 0);
    },

    async act(api) {
      for (let i = 0; i < MAX_ITERS; i += 1) {
        const s = await api.snapshot();
        if (s.screen !== "inWave") break;
        // Fire a matching-band shot at every live drone; the real collision destroys
        // it. Matching the band per drone is what makes the clear perfect — the
        // scoring path under test only pays the bonus if none is missed.
        for (const d of s.drones) {
          await api.call("spawnPlayerBullet", {
            x: d.x,
            y: d.y,
            band: d.effectiveBand ?? d.band,
            vy: -200,
          });
        }
        // Same simulation either way; only the last stretch is filmed.
        if (s.score >= FILM_FROM_SCORE) await api.advance(STEP_TICKS);
        else await api.skip(STEP_TICKS);
      }
      final = await api.snapshot();

      // Stay on the interstitial so the clip actually shows the score carrying the
      // perfect bonus, rather than cutting on the frame the stage ends.
      await api.advance(CLEARED_HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "the challenge ends on the stage-cleared screen",
        final.screen,
        "stageCleared",
      );
      check.expectEq(
        "a perfect clear scores 40x100 + a 10000 bonus",
        final.score,
        14000,
      );
    },
  };
}
