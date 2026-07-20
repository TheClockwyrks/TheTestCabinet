// Automated validation for the Collision sub-item `wall-fatal`.
//
// The head advancing into a wall cell ends the round immediately — that same tick,
// with no grace frame. The snake is posed one cell from the right wall facing it (a
// precondition); one real tick runs the head into the wall and the end state is read
// back. The snake must not have moved (a fatal tick ends before the head advances).

import { TICK_DT, hLane, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("collision.wall-fatal");

  await beginRound(api);
  // Head at (28, 8) = the last interior column; facing right into the wall at col 29.
  await api.call("setSnake", hLane(28, 8, 3), "right");
  await api.call("setPellet", { col: 5, row: 1 }); // far away — irrelevant to the hit

  await api.step(TICK_DT);
  const s = await api.snapshot();

  check.expectEq("the round ended", s.ended, true);
  check.expectEq("the screen is game-over", s.screen, "gameover");
  check.expectEq("the end reason is death", s.endReason, "dead");
  check.expectEq("the head did not move into the wall", s.snake[0].col, 28);
  check.expectEq("it ended on the very first tick", s.ticks, 1);

  // A live clip: the snake running into the wall and dying.
  await liveClip(api, { snake: hLane(24, 8, 3), dir: "right", pellet: { col: 3, row: 1 }, ms: 1000 });
  return check.verdict();
}
