// Automated validation for the Gameplay sub-item `serve-after-p2`.
//
// After a point is scored ON player two (player one scores — the ball leaves the
// RIGHT goal), the next serve travels toward player two, the receiver (vx > 0). A
// real point is driven out the right goal, then the next serve's horizontal direction
// is read back. base and gyre both serve toward the receiver and drive this same
// shared script; multi (random-angle launches) declares no such point. See
// validation/_helpers.mjs.

import { serveAfterGoalVx } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.serve-after-p2");

  // A point scored on player two: player one sends the ball out the RIGHT goal.
  const vx = await serveAfterGoalVx(api, "right");
  check.expectGt(
    "after a point is scored on player two, the next serve travels toward player two (vx)",
    vx,
    0,
  );

  // A clip: that serve heading toward the receiver. Hand the clock back to the
  // animation loop so the served ball actually moves in the clip.
  await api.call("setAutoStep", true);
  await api.wait(1000);

  return check.verdict();
}
