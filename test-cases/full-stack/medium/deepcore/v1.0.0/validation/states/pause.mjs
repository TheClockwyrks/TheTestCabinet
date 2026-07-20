// Automated validation for states.pause — the Esc pause menu is opened and captured. Layout is
// judged by eye from the capture.

import { newRun, press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.pause");
  await newRun(api);
  await press(api, "Escape"); // opens the pause menu in live play
  await api.wait(150);
  check.expectEq("the pause menu is reachable", (await api.snapshot()).screen, "paused");
  await api.screenshot("pause");
  return check.verdict();
}
