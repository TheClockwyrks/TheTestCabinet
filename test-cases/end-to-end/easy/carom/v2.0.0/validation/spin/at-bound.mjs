// Automated validation for the Spin sub-item `at-bound`: a paddle held against the
// top/bottom edge cannot move, so it is stationary and imparts no spin even while
// the movement key is still held. The real integrator clamps a bound-pinned paddle's
// velocity to zero (entities.ts: the clamped displacement, not the held input,
// becomes vy), so a build that drives spin off the held input rather than the
// paddle's actual motion fails this.
//
// Discriminating check: the SAME held velocity at mid-field DOES impart spin, so
// passing proves the build reads real motion — not that it never adds spin.

import { hitLeftPaddle, startPlaying, PADDLE_MAX_CY } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("spin.at-bound");

  // Paddle pinned at the bottom bound while holding "down" (vy = +720): it cannot
  // move, so the strike must add no spin and its reported vy must be ~0.
  await startPlaying(api);
  const bound = await hitLeftPaddle(api, {
    cy: PADDLE_MAX_CY,
    vy: 720,
    ballY: PADDLE_MAX_CY,
  });

  // Control: the same held velocity mid-field, where the paddle really moves,
  // must impart spin — proving the no-spin result above is due to no motion.
  await startPlaying(api);
  const free = await hitLeftPaddle(api, { cy: 340, vy: 720, ballY: 360 });

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

  // A clip: the bound-pinned paddle returns the ball on a straight line (no curve).
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: PADDLE_MAX_CY, vy: 720 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, {
    x: 120,
    y: PADDLE_MAX_CY,
    vx: -420,
    vy: 0,
    spin: 0,
  });
  await api.call("setAutoStep", true); // hand the clock back so the clip animates
  await api.wait(1500);

  return check.verdict();
}
