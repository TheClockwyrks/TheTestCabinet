// Automated validation for hud.core-countdown — a prominent core-sample countdown is shown while the
// Sample is carried. This extracts the Sample and captures the HUD; the countdown's prominence is
// judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hud.core-countdown");
  await newRun(api);
  await api.call("spawnCoreSample");
  await api.wait(150);
  check.expectOk("a Core Sample timer is running", (await api.snapshot()).coreTimer !== null);
  await api.screenshot("countdown");
  return check.verdict();
}
