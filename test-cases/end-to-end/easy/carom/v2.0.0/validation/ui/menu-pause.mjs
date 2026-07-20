// Automated validation for the UI sub-item `state-pause`: the pause menu is
// reachable, and the debug API captures it so a reviewer sees the actual menu.
//
// A match is started with injected keys and played into a live rally, then paused
// with Esc; the screen is read back and a screenshot captured as the reviewer's
// proof. Whether the menu (resume / restart / quit) reads well is judged by eye from
// the capture. See validation/_helpers.mjs.

import { startWithKeys } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-pause");

  await startWithKeys(api, "versus");
  await api.step(1.3); // past the pre-serve hold, into a live rally
  await api.wait(120);
  await api.call("press", "Escape"); // pause
  await api.wait(120);
  check.expectEq(
    "pressing Esc during a match opens the pause menu",
    (await api.snapshot()).screen,
    "paused",
  );
  await api.screenshot("pause");

  return check.verdict();
}
