// Automated validation for states.fuel-depot — the Fuel Depot panel is opened and captured. Layout
// is judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.fuel-depot");
  await newRun(api);
  await api.call("openPanel", "fuel-depot");
  await api.wait(150);
  check.expectEq("the Fuel Depot panel is open", (await api.snapshot()).panel, "fuel-depot");
  await api.screenshot("fuel-depot");
  return check.verdict();
}
