// Automated validation for the Gameplay sub-item `serve-after-p1`.
//
// After a point is scored ON player one (player two scores — the ball leaves the
// LEFT goal), the next serve travels toward player one, the receiver (vx < 0). A real
// point is driven out the left goal, then the next serve's horizontal direction is
// read back. base and gyre both serve toward the receiver and drive this same shared
// script; multi (random-angle launches) declares no such point. See
// validation/_helpers.mjs.

import { arrangeServeAfterGoal, actServeAfterGoalVx } from "../_helpers.mjs";

export default function item() {
  let vx;

  return {
    id: "gameplay.serve-after-p1",

    // A point scored on player one: player two sends the ball out the LEFT goal.
    async arrange(api) {
      await arrangeServeAfterGoal(api, "left");
    },

    // Play the posed point out through the real scoring code and serve the next ball.
    // This IS the clip: it ends with the served ball flying, so the reviewer sees the
    // direction the assertion reads (vx is captured before that flight).
    async act(api) {
      vx = await actServeAfterGoalVx(api);
    },

    async assert(api, check) {
      check.expectLt(
        "after a point is scored on player one, the next serve travels toward player one (vx)",
        vx,
        0,
      );
    },
  };
}
