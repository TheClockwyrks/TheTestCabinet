// Automated validation for the Paddles sub-item `rally-caps`.
//
// The per-hit speed-up stops at a ceiling (physics.md:
// `speed = min(speed * 1.04, 980)`), so however long a rally runs the ball plateaus
// at 980 px/s and never exceeds it. This drives a REAL straight rally (see
// `actRallySpeeds`), long enough to reach the ceiling, and confirms the peak speed is
// at the cap and the final speed has settled there. The gradual acceleration below the
// cap is the sibling `rally-accelerates` check.

import { arrangeRally, actRallySpeeds, SPEED_CAP } from "../_helpers.mjs";

export default function item() {
  let speeds;

  return {
    id: "paddles.rally-caps",

    // Two stationary, centered paddles and a ball launched level down the middle: a
    // center hit returns the ball level, so the rally can run the many hits it takes
    // to climb to the ceiling without ever leaving the field.
    async arrange(api) {
      await arrangeRally(api);
    },

    // Play the real rally, collecting the ball's speed after each successive hit. The
    // rally IS the clip — the reviewer watches it accelerate and then visibly stop
    // accelerating, which is the behavior these assertions read.
    async act(api) {
      speeds = await actRallySpeeds(api);
    },

    async assert(api, check) {
      const peak = Math.max(...speeds);
      const last = speeds[speeds.length - 1] ?? 0;

      check.expectGe(
        "the rally ran enough hits to reach the ceiling (hits)",
        speeds.length,
        12,
      );
      check.expectLe(
        "the ball's speed never exceeds the ceiling (peak)",
        peak,
        SPEED_CAP + 1,
      );
      check.expectClose(
        "the rally plateaus at the ceiling (final)",
        last,
        SPEED_CAP,
        1,
      );
    },
  };
}
