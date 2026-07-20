// Automated validation for the Turning sub-item `next-tick`.
//
// A requested turn does not move the snake immediately; the new direction is applied
// on the next tick. The snake is posed moving right (a precondition), a perpendicular
// turn is requested through the real key handling (press ArrowDown), the facing is
// read back BEFORE any tick (still right), then one real tick is stepped and the
// facing and head are read back (now down).

import { TICK_DT, hLane, PARK_PELLET, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("turning.next-tick");

  await beginRound(api);
  await api.call("setSnake", hLane(10, 8, 3), "right");
  await api.call("setPellet", PARK_PELLET);

  await api.call("press", "ArrowDown"); // request a turn (buffered for the next tick)
  const beforeTick = await api.snapshot();
  check.expectEq("the facing is unchanged before a tick", beforeTick.dir, "right");
  check.expectEq("the head has not moved yet (col)", beforeTick.snake[0].col, 10);

  await api.step(TICK_DT); // one tick applies the buffered turn
  const s = await api.snapshot();
  check.expectEq("the turn is applied on the next tick", s.dir, "down");
  check.expectEq("the head advanced downward (row)", s.snake[0].row, 9);
  check.expectEq("the head stayed in its column", s.snake[0].col, 10);

  await liveClip(api, { snake: hLane(8, 8, 4), pellet: { col: 18, row: 8 } });
  return check.verdict();
}
