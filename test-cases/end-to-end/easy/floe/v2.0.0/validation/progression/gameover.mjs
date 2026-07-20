// Automated validation for the Progression item `gameover`.
//
// Losing the last life ends the game (the game-over screen appears). Lives are set
// to one and a death driven; the real flow reaches game over, which the snapshot
// reads back and a screenshot captures. See validation/_helpers.mjs.

import { startCrossing, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("progression.gameover");

  await startCrossing(api);
  await api.call("setLives", 1);
  await api.call("setLane", 5, { cols: [] }); // open water -> drown the last life
  await api.call("placeCritter", 20, 5);

  const r = await stepUntil(api, (s) => s.screen === "gameover", 2, 0.05);
  check.expectOk("losing the last life ends the game", r.hit);
  check.expectEq("the game-over screen appears", r.snap.screen, "gameover");

  await api.wait(150);
  await api.screenshot("gameover");

  return check.verdict();
}
