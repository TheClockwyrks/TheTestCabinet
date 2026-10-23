// Automated validation for the Spin sub-item `stationary`: a paddle that is not
// moving imparts no new spin, so the ball's flight stays straight after contact.
//
// Drives a real stationary-paddle contact through window.__carom and reads back the
// spin the simulation imparts (physics.md: `spin += paddleVy * 0.85` on a hit — zero
// when the paddle is not moving). The paddle pose is a precondition; the bounce and
// the spin it does or does not add are produced by the real physics.

import {
  actLeftPaddleHit,
  arrangeLeftPaddleHit,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  // The bounce `act` read back, for `assert` to score.
  let still;

  return {
    id: "spin.stationary",

    // Stationary paddle, ball with no spin: the real bounce must impart none. Only
    // the poses are set here — the bounce itself is produced by the real physics in
    // `act`.
    async arrange(api) {
      await startPlaying(api);
      await arrangeLeftPaddleHit(api, { cy: 360, vy: 0, ballY: 360 });
    },

    async act(api) {
      still = await actLeftPaddleHit(api);
      // Let the returned ball travel on so the clip shows the very thing checked:
      // a stationary-paddle return crossing straight, with no curve.
      await api.advance(192); // 192 ticks = the old 1600ms clip hold
    },

    async assert(api, check) {
      check.expectOk("the stationary paddle strikes the ball", still.hit);
      check.expectClose(
        "a stationary-paddle hit imparts no spin (spin)",
        still.ball.spin,
        0,
        0.5,
      );
    },
  };
}
