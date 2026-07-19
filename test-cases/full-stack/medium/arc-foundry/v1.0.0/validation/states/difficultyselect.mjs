// Automated validation for states.difficultyselect: the difficulty-select state is reachable
// after a map is chosen.

import { snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.difficultyselect");

  await api.reset();
  await api.wait(80);
  await api.call("press", "Enter"); // title -> map select
  await api.call("press", "Enter"); // choose the first map -> difficulty select
  check.expectEq("the difficulty-select screen is reachable", (await snap(api)).screen, "difficultyselect");

  await api.screenshot("difficultyselect");
  return check.verdict();
}
