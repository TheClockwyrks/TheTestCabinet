// Automated validation for difficulty.select-menu: after MAP SELECT a DIFFICULTY SELECT lets
// the player pick Easy / Medium / Hard. This confirms the screen is reachable and captures it;
// how each entry reads what it changes is judged by eye from the capture.

import { snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("difficulty.select-menu");

  await api.reset();
  await api.wait(80);
  await api.call("press", "Enter"); // title -> map select
  check.expectEq("the map-select screen is reached", (await snap(api)).screen, "mapselect");
  await api.call("press", "Enter"); // choose the first map -> difficulty select
  check.expectEq("the difficulty-select screen is reachable", (await snap(api)).screen, "difficultyselect");

  await api.screenshot("select");
  return check.verdict();
}
