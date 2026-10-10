// Automated validation for the Ball sub-item `obstacle-no-speedup`: bouncing off a
// mid-field obstacle does not speed the ball up. Only a paddle hit multiplies the
// ball's speed; a wall or obstacle bounce preserves it (specs/physics.md).
//
// A ball is fired straight at obstacle A's left face at a known speed; the incoming
// and outgoing speeds are read off the real collision. The outgoing speed must match
// the incoming one — the obstacle reflects the ball without accelerating it.

import { clearPaddles, startPlaying, TICK, ball0 } from "../_helpers.mjs";

const OBSTACLE_A = { faceX: 480, y: 220 };
const SPEED = 600;

export default function item() {
  let before;
  let after;
  let hit;

  return {
    id: "ball.obstacle-no-speedup",

    // A live match with the ball lined up 180 px short of obstacle A's left face and
    // level with it, so the approach is a straight-on hit at a known speed.
    async arrange(api) {
      await startPlaying(api);
      await clearPaddles(api);
      await api.call("setBall", 0, {
        x: OBSTACLE_A.faceX - 180,
        y: OBSTACLE_A.y,
        vx: SPEED,
        vy: 0,
        spin: 0,
      });
    },

    // Run until the ball reflects off the obstacle (vx reverses), then read its speed.
    // Polls one tick at a time so the speed is read at the exact instant of the
    // rebound. 240 ticks = the old 2s cap. This IS the clip — the bank shot the
    // assertions measure, at the speed it really travels.
    async act(api) {
      before = ball0(await api.snapshot()).speed;

      const r = await api.until((s) => ball0(s).vx < 0, {
        max: 240,
        poll: TICK,
      });
      hit = r.hit;
      after = ball0(r.snap).speed;

      // A short tail so the clip shows the ball glancing away at a steady speed.
      // 60 ticks (0.5s) leaves it well inside the field.
      await api.advance(60);
    },

    async assert(api, check) {
      check.expectOk("the ball rebounds off obstacle A (vx reverses)", hit);
      // The reflection preserves speed exactly (it only rotates the velocity), and with
      // the manual clock the speed is read the instant it rebounds with no stray
      // wall-clock frames in between, so this is near-exact — only a float margin.
      check.expectClose(
        "an obstacle bounce leaves the ball's speed unchanged (px/s)",
        after,
        before,
        0.5,
      );
    },
  };
}
