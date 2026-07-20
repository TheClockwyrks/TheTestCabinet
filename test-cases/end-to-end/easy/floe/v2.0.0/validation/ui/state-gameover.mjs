// Automated validation for the UI item `state-gameover`: the game-over screen is
// reachable, and the debug API captures it. The last life is lost through the real
// flow (drowning) and the game-over screen read back and captured. The layout
// (play again / menu) is judged by eye.

import { startCrossing, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-gameover");

  await startCrossing(api);
  await api.call("setLives", 1);
  await api.call("setLane", 5, { cols: [] });
  await api.call("placeCritter", 20, 5);
  const r = await stepUntil(api, (s) => s.screen === "gameover", 2, 0.05);
  check.expectOk("losing the last life reaches the game-over screen", r.hit);
  await api.wait(150);
  await api.screenshot("gameover");

  return check.verdict();
}
