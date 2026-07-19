// Automated validation for the Turning sub-item `reversal-ignored`.
//
// A request to reverse straight back into the neck (the opposite of the current
// direction) is ignored; the snake keeps moving the way it was. The snake is posed
// moving right (a precondition), a reversal (ArrowLeft) is injected through the real
// key handling, one real tick is stepped, and the facing and head are read back — the
// snake must still be moving right.

import { TICK_DT, hLane, PARK_PELLET, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("turning.reversal-ignored");

  await beginRound(api);
  await api.call("setSnake", hLane(10, 8, 3), "right");
  await api.call("setPellet", PARK_PELLET);

  await api.call("press", "ArrowLeft"); // a reversal back into the neck
  await api.step(TICK_DT);
  const s = await api.snapshot();

  check.expectEq("the reversal is ignored — still moving right", s.dir, "right");
  check.expectEq("the head continued right (col)", s.snake[0].col, 11);
  check.expectEq("the head stayed on its row", s.snake[0].row, 8);
  check.expectEq("the round is still live (no self-fold)", s.ended, false);

  await liveClip(api, { snake: hLane(8, 8, 4), pellet: { col: 18, row: 8 } });
  return check.verdict();
}
