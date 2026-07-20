// Automated validation for the UI sub-item `state-pause`: the pause menu is
// reachable, and captured for the reviewer.
//
// A live wave is entered (its swarm kept behind the menu) and a pause key pressed
// with injected input; the resulting paused screen is read back and captured.

import { startClean } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-pause");

  await startClean(api, { clear: false });
  await api.step(0.6); // let some of the wave fly in behind the pause
  await api.call("press", "Escape");
  await api.wait(120);
  check.expectEq("a pause key pauses the wave", (await api.snapshot()).screen, "paused");
  await api.screenshot("pause");

  return check.verdict();
}
