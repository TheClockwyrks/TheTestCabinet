// Automated validation for states.game-over — the Game Over screen on death is reached and captured.
// Layout is judged by eye from the capture.

import { newRun, killByHull, SPAWN_COL, ROCKBED_ROW } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.game-over");
  await newRun(api);
  const end = await killByHull(api, SPAWN_COL, ROCKBED_ROW);
  check.expectEq("the Game Over screen is reached", end.screen, "game-over");
  await api.wait(150);
  await api.screenshot("game-over");
  return check.verdict();
}
