// Automated validation for the States sub-item `howto`: the how-to-play screen is
// reachable, navigated to from the title with injected keys, and captured.

import { navigateMenu } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.howto");

  await api.reset();
  await api.wait(60);
  await navigateMenu(api, 1); // title: CONTAINMENT -> HOW TO PLAY, then confirm
  await api.wait(150);
  check.expectEq("how to play is reachable", (await api.snapshot()).screen, "howto");
  await api.screenshot("howto");

  return check.verdict();
}
