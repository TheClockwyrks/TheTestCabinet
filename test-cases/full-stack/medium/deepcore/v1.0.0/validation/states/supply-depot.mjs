// Automated validation for states.supply-depot — the Supply Depot panel is opened (funded) and
// captured. Layout is judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.supply-depot");
  await newRun(api);
  await api.call("grantCredits", 5000);
  await api.call("openPanel", "supply-depot");
  await api.wait(150);
  check.expectEq("the Supply Depot panel is open", (await api.snapshot()).panel, "supply-depot");
  await api.screenshot("supply-depot");
  return check.verdict();
}
