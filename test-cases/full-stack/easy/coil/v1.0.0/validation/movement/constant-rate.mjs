// Automated validation for the Movement sub-item `constant-rate`.
//
// The snake advances at a constant 8 ticks per second: one second of game time is
// exactly eight ticks and eight cells of head travel. The snake is posed in a clear
// lane (a precondition), then exactly one second is stepped under the manual clock —
// step(1) advances exactly round(1 / 0.125) = 8 ticks regardless of machine load —
// and the tick count and head displacement are read back.

import { hLane, PARK_PELLET, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.constant-rate");

  await beginRound(api);
  await api.call("setSnake", hLane(5, 8, 3), "right"); // head (5,8)
  await api.call("setPellet", PARK_PELLET);

  const t0 = (await api.snapshot()).ticks;
  await api.step(1.0); // one second of game time
  const s = await api.snapshot();

  check.expectEq("one second is exactly eight ticks", s.ticks - t0, 8);
  check.expectEq("the head advanced exactly eight cells", s.snake[0].col, 13); // 5 + 8
  check.expectEq("the head stayed on its row", s.snake[0].row, 8);
  check.expectEq("the snake did not grow (no eat)", s.length, 3);
  check.expectEq("the round is still live", s.ended, false);

  await liveClip(api, { snake: hLane(4, 8, 4), pellet: { col: 16, row: 8 } });
  return check.verdict();
}
