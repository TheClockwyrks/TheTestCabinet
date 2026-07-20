// Automated validation for ui.state-pause: the pause menu is reachable from live
// play, and the debug API captures it. The layout (resume / restart / quit) is judged
// by eye from the capture.

import { freshBoard } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-pause");

  await freshBoard(api);
  await api.call("setLevel", 1); // a live board behind the pause
  await api.step(0.3);
  await api.call("press", "KeyP");
  await api.wait(150);
  check.expectEq("pausing during play reaches the pause menu", (await api.snapshot()).screen, "paused");
  await api.screenshot("pause");

  return check.verdict();
}
