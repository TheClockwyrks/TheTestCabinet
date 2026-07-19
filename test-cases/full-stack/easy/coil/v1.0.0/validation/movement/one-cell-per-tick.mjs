// Automated validation for the Movement sub-item `one-cell-per-tick`.
//
// Each fixed tick advances the head exactly one cell in the direction it faces, and
// every following segment takes the cell ahead of it. The snake is posed in a clear
// horizontal lane (a precondition); one real tick runs it forward and the snapshot
// reads back where each segment landed. Measured under the manual clock, so one
// step advances exactly one tick.

import { TICK_DT, hLane, PARK_PELLET, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.one-cell-per-tick");

  await beginRound(api);
  await api.call("setSnake", hLane(10, 8, 3), "right"); // head (10,8), body (9,8),(8,8)
  await api.call("setPellet", PARK_PELLET); // parked far — no eat this tick

  const before = await api.snapshot();
  check.expectEq("head starts at col 10", before.snake[0].col, 10);

  await api.step(TICK_DT); // exactly one tick
  const s = await api.snapshot();

  check.expectEq("the head advanced exactly one cell (col)", s.snake[0].col, 11);
  check.expectEq("the head stayed on its row", s.snake[0].row, 8);
  check.expectEq("the second segment took the head's old cell", s.snake[1].col, 10);
  check.expectEq("the third segment took the second's old cell", s.snake[2].col, 9);
  check.expectEq("the snake did not grow (no eat)", s.length, 3);
  check.expectEq("the round is still live", s.ended, false);

  await liveClip(api, { snake: hLane(6, 8, 4), pellet: { col: 18, row: 8 } });
  return check.verdict();
}
