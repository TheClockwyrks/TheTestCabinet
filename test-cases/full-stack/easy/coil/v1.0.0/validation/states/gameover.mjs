// Automated validation for the Game States sub-item `gameover`.
//
// A death ends the round on the game-over screen. A real death is driven (the head
// runs into a wall), the end state is read back, and the screen is captured so a
// reviewer sees the actual game-over panel (final score and BEST, play again / menu).

import { TICK_DT, hLane, beginRound } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.gameover");

  await beginRound(api);
  await api.call("setScore", 70); // a non-zero score to show on the panel
  await api.call("setSnake", hLane(28, 8, 3), "right"); // head at the last interior col
  await api.call("setPellet", { col: 5, row: 1 });

  await api.step(TICK_DT); // run into the wall -> death
  const s = await api.snapshot();
  check.expectEq("a death reaches the game-over screen", s.screen, "gameover");
  check.expectEq("the end reason is death", s.endReason, "dead");

  await api.wait(200);
  await api.screenshot("gameover");
  return check.verdict();
}
