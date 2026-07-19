// Automated validation for states.how-to-play — reached from the title menu, then captured. Layout
// is judged by eye from the capture.

import { cleanTitle, press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.how-to-play");
  await cleanTitle(api);
  await press(api, "ArrowDown"); // move to How To Play (second entry with no save)
  await press(api, "Enter");
  await api.wait(150);
  check.expectEq("how-to-play is reachable", (await api.snapshot()).screen, "how-to-play");
  await api.screenshot("how-to-play");
  return check.verdict();
}
