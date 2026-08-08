// Automated validation for the Gameplay sub-item `serve-after-p2`.
//
// After a point is scored ON player two (player one scores — the ball leaves the
// RIGHT goal), the next serve travels toward player two, the receiver (vx > 0). A
// real point is driven out the right goal, then the next serve's horizontal direction
// is read back. base and gyre both serve toward the receiver and drive this same
// shared script; multi (random-angle launches) declares no such point. See
// validation/_helpers.mjs.

import { arrangeServeAfterGoal, actServeAfterGoalVx } from "../_helpers.mjs";

export default function item() {
  let vx;

  return {
    id: "gameplay.serve-after-p2",

    // A point scored on player two: player one sends the ball out the RIGHT goal.
    async arrange(api) {
      await arrangeServeAfterGoal(api, "right");
    },

    // Play the posed point out through the real scoring code and serve the next ball.
    // This IS the clip: it ends with the served ball flying, so the reviewer sees the
    // direction the assertion reads (vx is captured before that flight).
    async act(api) {
      vx = await actServeAfterGoalVx(api);
    },

    async assert(api, check) {
      check.expectGt(
        "after a point is scored on player two, the next serve travels toward player two (vx)",
        vx,
        0,
      );
    },
  };
}
