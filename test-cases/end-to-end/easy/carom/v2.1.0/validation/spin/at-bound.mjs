// Automated validation for the Spin sub-item `at-bound`: a paddle held against the
// top/bottom edge cannot move, so it is stationary and imparts no spin even while
// the movement key is still held. The real integrator clamps a bound-pinned paddle's
// velocity to zero (entities.ts: the clamped displacement, not the held input,
// becomes vy), so a build that drives spin off the held input rather than the
// paddle's actual motion fails this.
//
// Discriminating check: the SAME held velocity clear of the bound DOES impart spin,
// so passing proves the build reads real motion — not that it never adds spin.

import {
  actLeftPaddleHit,
  arrangeLeftPaddleHit,
  neutralizeExtraBalls,
  startPlaying,
  PADDLE_MAX_CY,
  LEAD_TICKS,
} from "../_helpers.mjs";

// Where the ball starts for the bound contact. The paddle there must stay PINNED, so
// it cannot be led upstream the way a swinging one is (`arrangePaddleHit`) — leading
// it would unpin it and hand it back the velocity this check exists to deny. Only the
// ball is pushed back instead: 85 (its zero-lead start) plus the 200 px it covers at
// 400 px/s over the half-second run-up.
const BOUND_START_X = 285;

export default function item() {
  // The two contacts `act` read back, for `assert` to score.
  let bound;
  let free;

  return {
    id: "spin.at-bound",

    // Paddle pinned at the bottom bound while holding "down" (vy = +720): it cannot
    // move, so the strike must add no spin and its reported vy must be ~0. Only this
    // first contact can be posed here — the free-paddle control needs a fresh match,
    // which cannot be started until this one has been driven.
    async arrange(api) {
      await startPlaying(api);
      await arrangeLeftPaddleHit(api, {
        cy: PADDLE_MAX_CY,
        vy: 720,
        ballY: PADDLE_MAX_CY,
        startX: BOUND_START_X,
      });
    },

    async act(api) {
      bound = await actLeftPaddleHit(api, { leadTicks: LEAD_TICKS });
      // Let the return fly on, so the clip shows the bound-pinned paddle sending the
      // ball back on a straight line (no curve) — the behavior being checked.
      await api.advance(90); // 90 ticks (0.75s) of visible straight flight

      // Control: the same held velocity clear of the bound, where the paddle really
      // moves, must impart spin — proving the no-spin result above is due to no motion.
      //
      // Reopened with startMatch/serve rather than startPlaying, which leads with a
      // reset: nothing here needs the build returned to the title, and re-posing the
      // paddle and ball directly keeps the clip continuous between the two contacts.
      //
      // This contact is at y=500: the swing here IS meant to move, so over the
      // half-second run-up `arrangeLeftPaddleHit` starts the paddle 360 px upstream
      // (cy 120) to arrive as the ball does. Aimed mid-field that start would fall
      // above the field edge and the clamp would pin it — the very condition this half
      // is the control FOR. It is still a paddle free to move, well clear of the
      // bottom bound, struck by a level ball.
      await api.call("startMatch", "versus");
      await api.call("serve");
      await neutralizeExtraBalls(api);
      await arrangeLeftPaddleHit(api, {
        cy: 480,
        vy: 720,
        ballY: 500,
        leadTicks: LEAD_TICKS,
      });
      free = await actLeftPaddleHit(api, { leadTicks: LEAD_TICKS });
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
      check.expectOk("the free-paddle control strikes the ball", free.hit);
      check.expectGt(
        "the same held key clear of the bound, where the paddle really moves, does impart spin (spin)",
        free.ball.spin,
        400,
      );
    },
  };
}
