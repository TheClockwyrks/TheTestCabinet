// Automated validation for the Maze sub-item `obstacles-fatal`.
//
// The head advancing into an interior obstacle cell ends the round immediately as a
// death, exactly like a wall. The snake is posed one cell from an obstacle facing it
// (a precondition — bar 1 sits along row 4, so a head at (8,5) facing up runs into the
// obstacle at (8,4)); one real tick resolves the collision and the end state is read
// back.

import { TICK_DT, vLaneUp, liveClip, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze.obstacles-fatal");

  await beginRound(api);
  // Head at (8,5) facing up; the cell above, (8,4), is a fixed obstacle (bar 1).
  await api.call("setSnake", vLaneUp(8, 5, 3), "up");
  await api.call("setPellet", { col: 25, row: 8 }); // far away — irrelevant to the hit

  await api.step(TICK_DT);
  const s = await api.snapshot();

  check.expectEq("the round ended", s.ended, true);
  check.expectEq("the screen is game-over", s.screen, "gameover");
  check.expectEq("the end reason is death", s.endReason, "dead");
  check.expectEq("the head did not move into the obstacle", s.snake[0].row, 5);

  // A live clip: the snake running into the obstacle course and dying.
  await liveClip(api, { snake: vLaneUp(8, 7, 3), dir: "up", pellet: { col: 25, row: 8 }, ms: 900 });
  return check.verdict();
}
