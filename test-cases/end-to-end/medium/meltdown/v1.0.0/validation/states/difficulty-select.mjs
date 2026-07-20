// Automated validation for the States sub-item `difficulty-select`.
//
// Choosing Containment opens a difficulty select (specs/states.md, modes.md).
// Containment leads the mode list, so from the title PLAY then confirm reaches it.

import { press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.difficulty-select");
  await api.reset();
  await press(api, "Enter"); // PLAY -> mode select
  await press(api, "Enter"); // CONTAINMENT -> difficulty select
  await api.wait(120);
  check.expectEq("Containment opens difficulty select", (await api.snapshot()).screen, "difficultyselect");
  await api.screenshot("difficulty");
  return check.verdict();
}
