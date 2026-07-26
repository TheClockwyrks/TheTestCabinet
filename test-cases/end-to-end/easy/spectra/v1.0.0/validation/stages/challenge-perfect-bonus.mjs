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
            band: d.band,
            vy: -200,
          });
        }
        await api.advance(STEP_TICKS);
      }
      final = await api.snapshot();
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
