// Automated validation for the Multi-ball sub-item `ball-collision`: balls collide
// elastically with each other, never passing through or merging.
//
// Two balls are set on a head-on collision course down the y=360 lane (the third is
// parked away); the real ball-to-ball resolution runs as the simulation advances. The
// two must rebound — an equal-mass head-on collision swaps their velocities, so each
// reverses — while never interpenetrating (the center gap stays at least two radii)
// and never crossing past one another.

import { clearPaddles, TICK } from "../_helpers.mjs";

const TWO_RADII = 22; // BALL_COLLIDE_DIST — the touch distance of two balls

export default function item() {
  // What the sweep in `act` observed, for `assert` to score.
  let minGap = Infinity;
  let after = null;

  return {
    id: "multi-ball.ball-collision",

    async arrange(api) {
      await api.reset({ seed: 2 });
      await api.call("startMatch", "versus");
      await api.call("serve");
      await clearPaddles(api);
      // Park the third ball out of the lane; aim the other two straight at each other.
      await api.call("setBall", 2, { x: 30, y: 30, vx: 0, vy: 0, spin: 0 });
      await api.call("setBall", 0, { x: 520, y: 360, vx: 400, vy: 0, spin: 0 });
      await api.call("setBall", 1, {
        x: 760,
        y: 360,
        vx: -400,
        vy: 0,
        spin: 0,
      });
    },

    async act(api) {
      // Sweep in small increments, tracking the closest the two centers ever come and
      // the moment ball 0 reverses (the collision). The predicate carries the tracking
      // because `until` only hands back the final snapshot.
      //
      // The old loop was 200 reads 0.01 s apart. 0.01 s is 1.2 ticks, not a whole
      // tick: poll one TICK, the finest the simulation has — the closest-approach
      // measurement can only get sharper, never coarser, from reading more often — and
      // cap at 240 ticks so the sweep still covers the same 2 s window (200 x 1.2).
      await api.until(
        (s) => {
          const [b0, b1] = s.balls;
          const gap = Math.hypot(b1.x - b0.x, b1.y - b0.y);
          if (gap < minGap) minGap = gap;
          if (b0.vx < 0) {
            after = s.balls;
            return true;
          }
          return false;
        },
        { max: 240, poll: TICK },
      );

      // Stay on the rebound so the clip shows the two balls bouncing apart rather
      // than cutting at the instant of contact.
      await api.advance(120); // 120 ticks (1 s) of visible separation
    },

    async assert(api, check) {
      check.expectOk(
        "two balls on a collision course collide and ball 0 rebounds",
        after !== null,
      );
      check.expectLt(
        "ball 0 reverses to travel left after the collision (vx)",
        after ? after[0].vx : 0,
        0,
      );
      check.expectGt(
        "ball 1 reverses to travel right after the collision (vx)",
        after ? after[1].vx : 0,
        0,
      );
      check.expectOk(
        "the balls do not cross past each other (ball 0 stays left of ball 1)",
        after !== null && after[0].x < after[1].x,
      );
      check.expectGe(
        "the balls never overlap or merge (closest center gap)",
        minGap,
        TWO_RADII - 1,
      );
    },
  };
}
