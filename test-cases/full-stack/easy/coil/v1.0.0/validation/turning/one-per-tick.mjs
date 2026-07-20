// Automated validation for the Turning sub-item `one-per-tick`.
//
// At most one buffered turn is applied per tick, so a rapid double-press cannot fold
// the snake onto itself. Moving right, two perpendicular turns (down then left) are
// injected through the real key handling within one tick; the first tick applies
// down and the second applies left, and the snake never dies. The snake is posed
// moving right (a precondition); the outcome is read back after each real tick.

import { TICK_DT, hLane, PARK_PELLET, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("turning.one-per-tick");

  await beginRound(api);
  await api.call("setSnake", hLane(10, 8, 3), "right");
  await api.call("setPellet", PARK_PELLET);

  // Two turns queued within one tick — no step between them.
  await api.call("press", "ArrowDown");
  await api.call("press", "ArrowLeft");

  await api.step(TICK_DT); // first tick: down applied
  const s1 = await api.snapshot();
  check.expectEq("the first tick applies the first turn (down)", s1.dir, "down");
  check.expectEq("the head moved down (row)", s1.snake[0].row, 9);
  check.expectEq("still live after the first turn", s1.ended, false);

  await api.step(TICK_DT); // second tick: left applied
  const s2 = await api.snapshot();
  check.expectEq("the second tick applies the second turn (left)", s2.dir, "left");
  check.expectEq("the head moved left (col)", s2.snake[0].col, 9);
  check.expectEq("the snake never folded onto itself (still live)", s2.ended, false);

  await liveClip(api, { snake: hLane(8, 8, 4), pellet: { col: 18, row: 8 } });
  return check.verdict();
}
