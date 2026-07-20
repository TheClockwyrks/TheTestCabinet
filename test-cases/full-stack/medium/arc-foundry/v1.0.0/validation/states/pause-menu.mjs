// Automated validation for states.pause-menu: the Esc pause menu is reachable over a frozen
// board (Resume / Restart / Quit), distinct from the in-place pause.

import { startBuild, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.pause-menu");

  await startBuild(api); // playing, opening build phase, nothing held or selected
  await api.call("press", "Escape"); // opens the pause menu
  check.expectEq("the Esc pause menu is reachable", (await snap(api)).screen, "paused");

  await api.screenshot("menu");
  return check.verdict();
}
