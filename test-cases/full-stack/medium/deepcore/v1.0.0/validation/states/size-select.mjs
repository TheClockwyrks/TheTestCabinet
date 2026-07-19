// Automated validation for states.size-select — reached from the title via New Expedition → a mode,
// then captured. Layout is judged by eye from the capture.

import { cleanTitle, press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.size-select");
  await cleanTitle(api);
  await press(api, "Enter"); // New Expedition → mode select
  await press(api, "Enter"); // Standard (the first mode) → size select
  await api.wait(150);
  check.expectEq("size select is reachable", (await api.snapshot()).screen, "size-select");
  await api.screenshot("size-select");
  return check.verdict();
}
