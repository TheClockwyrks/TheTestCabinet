// Automated validation for the Pause sub-item `ball-suspended`: a ball in flight is
// suspended while the game is paused — it hangs exactly where it was rather than
// drifting on behind the pause menu.
//
// A live ball is posed mid-flight, allowed to travel for a moment (so it is
// demonstrably moving), then the game is paused. Over a long paused stretch the ball
// must not move at all. See validation/_helpers.mjs.

import { arrangeLiveBall, ball0 } from "../_helpers.mjs";

export default function item() {
  let start;
  let paused;
  let later;

  return {
    id: "pause.ball-suspended",

    // A live match with the ball posed mid-flight, clear of the obstacles.
    async arrange(api) {
      await arrangeLiveBall(api, { x: 500, y: 360, vx: 400, vy: -120 });
    },

    // Let the ball fly, pause, then let a long stretch pass while paused. The whole
    // sequence IS the clip: the ball moves, then stops dead at the pause.
    async act(api) {
      start = ball0(await api.snapshot());
      await api.advance(30); // 0.25 s of visible flight
      await api.call("press", "Escape");
      paused = await api.snapshot();
      await api.advance(180); // 1.5 s paused — plenty for any drift to show
      later = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("the game is paused", paused.screen, "paused");
      const p = ball0(paused);
      const l = ball0(later);
      check.expectGt(
        "the ball was actually in flight before the pause (px moved)",
        Math.hypot(p.x - start.x, p.y - start.y),
        10,
      );
      check.expectClose(
        "the suspended ball does not drift while paused (x)",
        l.x,
        p.x,
        1,
      );
      check.expectClose(
        "the suspended ball does not drift while paused (y)",
        l.y,
        p.y,
        1,
      );
    },
  };
}
