// Automated validation for ui.state-gameover: the Game-over screen is reachable, and
// the debug API captures it. The layout is judged by eye from the capture. The state
// is reached the real way — losing the last life.

import { freshBoard, setWorm } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-gameover");

  await freshBoard(api);
  await api.call("setLives", 1);
  await api.call("setCursor", 640, 688);
  await setWorm(api, [{ c: 20, r: 19 }], 1, 1);

  await api.step(0.05);
  check.expectEq("the Game-over screen is reachable", (await api.snapshot()).screen, "gameover");

  await api.wait(300);
  await api.screenshot("gameover");

  return check.verdict();
}
