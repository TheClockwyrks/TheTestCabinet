// State: the title / main menu is the initial screen. Captured so a reviewer sees the menu.

import { settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.title");
  await api.reset();
  await settle(api, 150);
  check.expectEq("the title menu is the initial screen", (await api.snapshot()).screen, "title");
  await api.screenshot("state");
  return check.verdict();
}
