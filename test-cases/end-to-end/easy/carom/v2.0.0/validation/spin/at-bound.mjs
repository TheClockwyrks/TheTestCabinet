// Automated validation for the Spin sub-item `at-bound`: a paddle held against the
// top/bottom edge cannot move, so it is stationary and imparts no spin even while
// the movement key is still held. The real integrator clamps a bound-pinned paddle's
// velocity to zero (entities.ts: the clamped displacement, not the held input,
// becomes vy), so a build that drives spin off the held input rather than the
// paddle's actual motion fails this.
//
// Discriminating check: the SAME held velocity at mid-field DOES impart spin, so
// passing proves the build reads real motion — not that it never adds spin.

import {
  actLeftPaddleHit,
  arrangeLeftPaddleHit,
  neutralizeExtraBalls,
  startPlaying,
  PADDLE_MAX_CY,
} from "../_helpers.mjs";

export default function item() {
  // The two contacts `act` read back, for `assert` to score.
  let bound;
  let free;

  return {
    id: "spin.at-bound",

    // Paddle pinned at the bottom bound while holding "down" (vy = +720): it cannot
    // move, so the strike must add no spin and its reported vy must be ~0. Only this
    // first contact can be posed here — the mid-field control needs a fresh match,
    // which cannot be started until this one has been driven.
    async arrange(api) {
      await startPlaying(api);
      await arrangeLeftPaddleHit(api, {
        cy: PADDLE_MAX_CY,
        vy: 720,
        ballY: PADDLE_MAX_CY,
      });
    },

    async act(api) {
      bound = await actLeftPaddleHit(api);
      // Let the return fly on, so the clip shows the bound-pinned paddle sending the
      // ball back on a straight line (no curve) — the behavior being checked.
      await api.advance(90); // 90 ticks (0.75s) of visible straight flight

      // Control: the same held velocity mid-field, where the paddle really moves,
      // must impart spin — proving the no-spin result above is due to no motion.
      //
      // Reopened with startMatch/serve rather than startPlaying, which leads with a
      // reset: nothing here needs the build returned to the title, and re-posing the
      // paddle and ball directly keeps the clip continuous between the two contacts.
      await api.call("startMatch", "versus");
      await api.call("serve");
      await neutralizeExtraBalls(api);
      await arrangeLeftPaddleHit(api, { cy: 340, vy: 720, ballY: 360 });
      free = await actLeftPaddleHit(api);
      // The contrasting curve, so the clip shows both halves of the discrimination
      // (the two 0.75s tails together match the old 1500ms clip).
      await api.advance(90);
    },

    async assert(api, check) {
      check.expectOk("the bound-pinned paddle strikes the ball", bound.hit);
      check.expectClose(
        "a paddle pinned at the bound reports zero velocity (vy)",
        bound.paddle.vy,
        0,
        1,
      );
      check.expectClose(
        "so it imparts no spin even with the key held into the bound (spin)",
        bound.ball.spin,
        0,
        0.5,
      );
      check.expectOk("the mid-field control paddle strikes the ball", free.hit);
      check.expectGt(
        "the same held key mid-field, where the paddle really moves, does impart spin (spin)",
        free.ball.spin,
        400,
      );
    },
  };
}
