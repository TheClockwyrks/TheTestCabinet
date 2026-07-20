// Automated validation for states.title: the title / main menu is the initial state. The
// screen is read back and captured so a reviewer sees the actual menu.

import { snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.title");

  await api.reset();
  await api.wait(120);
  check.expectEq("the title / main menu is the initial screen", (await snap(api)).screen, "title");

  await api.screenshot("title");
  return check.verdict();
}
