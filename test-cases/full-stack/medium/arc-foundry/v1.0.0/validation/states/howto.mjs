// Automated validation for states.howto: the how-to-play state is reachable from the title.

import { snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.howto");

  await api.reset();
  await api.wait(80);
  await api.call("press", "ArrowDown"); // move to HOW TO PLAY
  await api.call("press", "Enter");
  check.expectEq("the how-to-play screen is reachable", (await snap(api)).screen, "howto");

  await api.screenshot("howto");
  return check.verdict();
}
