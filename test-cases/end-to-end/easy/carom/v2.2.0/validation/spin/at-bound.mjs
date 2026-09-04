// Automated validation for the Spin sub-item `at-bound`: a paddle held against the
// top/bottom edge cannot travel, so it imparts no spin even while the movement key is
// still held into the bound. `specs/playfield.md` clamps a paddle's center to
// [55, 665] and drives the spin mechanic from the motion it actually made this step,
// so a paddle already pinned there adds nothing to the ball however long the key is
// held — the ball comes off it straight.
//
// What the paddle REPORTS as its `vy` while pinned is not graded. `specs/playfield.md`
// says a paddle moves at 720 px/s while a movement key is held, so a build that keeps
// reporting the held 720 against the bound is reading the spec as fairly as one that
// reports the zero it actually travelled. Both are conformant, and the thing this
// point is about — what the pinned paddle does to the ball — is identical either way.
//
// Discriminating check: the SAME held velocity clear of the bound DOES impart spin and
// DOES bend the flight, so passing proves the build reads real motion — not that it
// never adds spin.

import {
  actLeftPaddleHit,
  arrangeLeftPaddleHit,
  actCurveOffset,
  assertCurved,
  assertStraight,
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
  // The two contacts `act` read back, and the flight after each, for `assert` to score.
  let bound;
  let boundFlight;
  let free;
  let freeFlight;

  return {
    id: "spin.at-bound",

    // Paddle pinned at the bottom bound while holding "down" (vy = +720): it cannot
    // travel, so the strike must add no spin and the return must fly straight. Only
    // this first contact can be posed here — the free-paddle control needs a fresh
    // match, which cannot be started until this one has been driven.
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
      // ball back on a straight line (no curve) — and measure that straightness,
      // rather than only inferring it from a zero spin reading. The return rides out
      // along the bottom of the field, clear of both obstacles, so the whole window is
      // free flight.
      boundFlight = await actCurveOffset(api, 90); // 90 ticks (0.75s) of measured flight

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
      // The contrasting curve, measured over free flight short of the bottom wall it
      // bends toward, then held for the rest of the tail so the clip shows both halves
      // of the discrimination (the two 0.75s tails together match the old 1500ms clip).
      freeFlight = await actCurveOffset(api, 72);
      await api.advance(18);
    },

    async assert(api, check) {
      // Each half reads the rebound itself — the ball turned back toward the far goal
      // — beside its spin. `paddles.hit-center` and `hit-edge` grade that a paddle
      // returns a ball; what these two need from it is that the ball did not pass
      // THROUGH the paddle, which the pinned half's readings cannot tell on their own:
      // it scores two zeroes, and a ball that sailed by an unmoved paddle reports both.
      // A tunnelled ball crosses the goal line and is held for the pre-serve countdown
      // (~120 ticks, `gameplay.countdown-length`), well past the sweep's 132-tick cap,
      // so it never turns positive on a fresh serve instead.
      check.expectGt(
        "the ball rebounds off the bound-pinned paddle rather than passing through it (vx)",
        bound.ball.vx,
        0,
      );
      check.expectClose(
        "a paddle pinned at the bound imparts no spin even with the key held into it (spin)",
        bound.ball.spin,
        0,
        0.5,
      );
      assertStraight(check, boundFlight, {
        who: "the return off the bound-pinned paddle",
      });
      check.expectGt(
        "the ball rebounds off the free paddle rather than passing through it (vx)",
        free.ball.vx,
        0,
      );
      check.expectGt(
        "the same held key clear of the bound, where the paddle really moves, does impart spin (spin)",
        free.ball.spin,
        400,
      );
      assertCurved(check, freeFlight, {
        who: "that same key's shot clear of the bound",
      });
    },
  };
}
