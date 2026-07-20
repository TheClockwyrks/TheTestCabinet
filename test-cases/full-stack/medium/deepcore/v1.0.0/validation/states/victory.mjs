// Automated validation for states.victory — the Victory screen after a launch is reached and
// captured. Layout is judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.victory");
  await newRun(api);
  await api.call("grantCredits", 30000);
  await api.call("giveMaterial", "resonite");
  await api.call("giveMaterial", "cryenite");
  await api.call("spawnCoreSample");
  for (let i = 0; i < 5; i += 1) await api.call("fabricate");
  await api.call("launch");
  await api.step(3);
  await api.wait(150);
  check.expectEq("the Victory screen is reached", (await api.snapshot()).screen, "victory");
  await api.screenshot("victory");
  return check.verdict();
}
