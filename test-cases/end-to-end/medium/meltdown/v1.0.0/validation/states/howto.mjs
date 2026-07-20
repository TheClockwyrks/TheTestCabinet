// Automated validation for the States sub-item `howto`.
//
// The how-to-play state is reachable (specs/states.md). HOW TO PLAY is the second
// title entry, so we move down and confirm.

import { press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.howto");
  await api.reset();
  await press(api, "ArrowDown"); // PLAY -> HOW TO PLAY
  await press(api, "Enter");
  await api.wait(120);
  check.expectEq("HOW TO PLAY opens the how-to screen", (await api.snapshot()).screen, "howto");
  await api.screenshot("howto");
  return check.verdict();
}
