// Automated validation for states.upgrade-shop — the Upgrade Shop panel is opened (funded so the
// tracks read as affordable) and captured. Layout is judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.upgrade-shop");
  await newRun(api);
  await api.call("grantCredits", 5000);
  await api.call("openPanel", "upgrade-shop");
  await api.wait(150);
  check.expectEq("the Upgrade Shop panel is open", (await api.snapshot()).panel, "upgrade-shop");
  await api.screenshot("upgrade-shop");
  return check.verdict();
}
