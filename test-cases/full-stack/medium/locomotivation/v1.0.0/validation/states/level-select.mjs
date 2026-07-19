// State: the level-select / campaign screen is reachable from the title (PLAY).

import { settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.level-select");
  await api.reset();
  await api.call("press", "Enter"); // PLAY
  await settle(api, 150);
  check.expectEq("PLAY reaches the level-select screen", (await api.snapshot()).screen, "level-select");
  await api.screenshot("state");
  return check.verdict();
}
