// Automated validation for states.launch-pad — the Launch Pad panel (the rocket checklist) is opened
// and captured. Layout is judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.launch-pad");
  await newRun(api);
  await api.call("grantCredits", 5000);
  await api.call("openPanel", "launch-pad");
  await api.wait(150);
  check.expectEq("the Launch Pad panel is open", (await api.snapshot()).panel, "launch-pad");
  await api.screenshot("launch-pad");
  return check.verdict();
}
