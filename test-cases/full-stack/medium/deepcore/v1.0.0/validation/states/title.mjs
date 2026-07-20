// Automated validation for states.title — the title / main menu is reachable, and captured so a
// reviewer sees the actual screen. The auto-verdict confirms reachability; layout is judged by eye.

import { cleanTitle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.title");
  await cleanTitle(api);
  await api.wait(150);
  check.expectEq("the title is the initial screen", (await api.snapshot()).screen, "title");
  await api.screenshot("title");
  return check.verdict();
}
