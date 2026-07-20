// Automated validation for the Game States sub-item `board-cleared`.
//
// Filling the board so no new pellet can spawn ends the round cleanly on a BOARD
// CLEARED screen. The snake is posed occupying every free cell but one, with its head
// adjacent to that last free cell and the pellet on it (a precondition that works for
// both Classic and Maze — see buildFillSnake). One real tick eats there: the snake
// grows to fill every free cell and the real pellet spawn finds no cell left, ending
// the round CLEARED. What the check reads (the CLEARED end) resolves through the real
// tick, not the pose.

import { TICK_DT, buildFillSnake, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.board-cleared");

  await beginRound(api);
  const fill = await buildFillSnake(api);
  await api.call("setSnake", fill.snake, fill.dir);
  await api.call("setPellet", fill.pellet);

  const before = await api.snapshot();
  check.expectEq("the snake fills every free cell but one", before.length, fill.freeCount - 1);
  check.expectEq("the round is still live before the last eat", before.ended, false);

  await api.step(TICK_DT); // eat the last free cell -> nothing left to spawn
  const s = await api.snapshot();
  check.expectEq("the round ended", s.ended, true);
  check.expectEq("it ended CLEARED, not as a death", s.endReason, "cleared");
  check.expectEq("the screen is the board-cleared screen", s.screen, "cleared");
  check.expectEq("no pellet remains once the board is cleared", s.pellet, null);

  await api.wait(200);
  await api.screenshot("cleared");
  return check.verdict();
}
