// Automated validation for states.mode-select — reached from the title via New Expedition, then
// captured. Layout is judged by eye from the capture.

import { cleanTitle, press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.mode-select");
  await cleanTitle(api);
  await press(api, "Enter"); // New Expedition (the first entry with no save)
  await api.wait(150);
  check.expectEq("mode select is reachable", (await api.snapshot()).screen, "mode-select");
  await api.screenshot("mode-select");
  return check.verdict();
}
