// Automated validation for the Gameplay sub-item `serve-after-p1`.
//
// After a point is scored ON player one (player two scores — the ball leaves the
// LEFT goal), the next serve travels toward player one, the receiver (vx < 0). A real
// point is driven out the left goal, then the next serve's horizontal direction is
// read back. base and gyre both serve toward the receiver and drive this same shared
// script; multi (random-angle launches) declares no such point. See
// validation/_helpers.mjs.

import { serveAfterGoalVx } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.serve-after-p1");

  // A point scored on player one: player two sends the ball out the LEFT goal.
  const vx = await serveAfterGoalVx(api, "left");
  check.expectLt(
    "after a point is scored on player one, the next serve travels toward player one (vx)",
    vx,
    0,
  );

  // A clip: that serve heading toward the receiver.
  await api.wait(1000);

  return check.verdict();
}
