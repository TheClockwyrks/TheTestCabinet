// Automated validation for the UI item `state-pause`: the pause menu is reachable,
// and the debug API captures it. A live run is paused and the pause screen read
// back and captured. The layout (resume/restart/quit) is judged by eye.

import { startCrossing } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-pause");

  await startCrossing(api);
  await api.wait(300);
  await api.call("press", "KeyP");
  await api.wait(120);
  check.expectEq("pausing a live run opens the pause menu", (await api.snapshot()).screen, "paused");
  await api.screenshot("pause");

  return check.verdict();
}
