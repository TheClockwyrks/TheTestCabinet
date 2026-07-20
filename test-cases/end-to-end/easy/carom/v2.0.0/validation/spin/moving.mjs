// Automated validation for the Spin sub-item `moving`: a paddle swung as it strikes
// the ball imparts significant spin, and up vs. down curve the ball opposite ways
// (opposite spin signs).
//
// Drives real moving-paddle contacts through window.__carom and reads back the spin
// the simulation imparts (physics.md: `spin += paddleVy * 0.85` on a hit). The
// paddle's pose and motion are preconditions; the bounce — and the spin it adds — is
// produced by the real physics.

import {
  actLeftPaddleHit,
  arrangeLeftPaddleHit,
  neutralizeExtraBalls,
  startPlaying,
} from "../_helpers.mjs";

export default function item() {
  // The two bounces `act` read back, for `assert` to compare.
  let down;
  let up;

  return {
    id: "spin.moving",

    // Moving paddle, downward (vy > 0): must impart significant positive spin. Only
    // the first contact can be posed here — the second is posed in `act`, after the
    // first has been driven.
    async arrange(api) {
      await startPlaying(api);
      await arrangeLeftPaddleHit(api, { cy: 340, vy: 720, ballY: 360 });
    },

    async act(api) {
      down = await actLeftPaddleHit(api);
      // Let the downward-swung return fly on, so the clip shows the curve the spin
      // it just imparted produces.
      await api.advance(96); // 96 ticks (0.8s) of visible curve

      // Moving paddle, upward (vy < 0): significant spin of the OPPOSITE sign. Posed
      // here because it needs a fresh match, which cannot happen until the first
      // contact has been driven and read.
      //
      // Reopened with startMatch/serve rather than startPlaying, which leads with a
      // reset: nothing here needs the build returned to the title, and re-posing the
      // paddle and ball directly keeps the clip continuous between the two contacts.
      await api.call("startMatch", "versus");
      await api.call("serve");
      await neutralizeExtraBalls(api);
      await arrangeLeftPaddleHit(api, { cy: 380, vy: -720, ballY: 360 });
      up = await actLeftPaddleHit(api);
      // The opposite curve, so the clip shows both halves of the contrast (the two
      // 0.8s tails together match the old 1600ms clip).
      await api.advance(96);
    },

    async assert(api, check) {
      check.expectOk("a downward swing contacts the paddle", down.hit);
      check.expectGt(
        "a downward swing imparts significant positive spin (spin)",
        down.ball.spin,
        400,
      );
      check.expectOk("an upward swing contacts the paddle", up.hit);
      check.expectLt(
        "an upward swing imparts significant negative spin (spin)",
        up.ball.spin,
        -400,
      );
      check.expectOk(
        "up and down swings curve the ball opposite ways (opposite spin signs)",
        Math.sign(down.ball.spin) === -Math.sign(up.ball.spin),
      );
    },
  };
}
