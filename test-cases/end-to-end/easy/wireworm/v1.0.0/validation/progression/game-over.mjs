// Automated validation for progression.game-over: losing the last life ends the run
// on the Game-over screen, recording the level reached.
//
// One life and a worm segment on the cursor's tile are the preconditions; the end is
// produced by the real loseLife path (lives -> 0 -> gameover) when the sim steps, read
// back and captured.

import { freshBoard, setWorm } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("progression.game-over");

  await freshBoard(api);
  await api.call("setLives", 1);
  await api.call("setCursor", 640, 688); // tile (20,19)
  await setWorm(api, [{ c: 20, r: 19 }], 1, 1);

  await api.step(0.05);
  const snap = await api.snapshot();
  check.expectEq("losing the last life ends the game", snap.screen, "gameover");
  check.expectEq("no lives remain", snap.lives, 0);
  check.expectGt("the level reached is recorded", snap.reachedLevel, 0);

  await api.wait(300);
  await api.screenshot("game-over");

  return check.verdict();
}
