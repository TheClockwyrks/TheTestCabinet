// State: the how-to-play screen is reachable from the title (HOW TO PLAY).

import { settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.how-to-play");
  await api.reset();
  await api.call("press", "ArrowDown"); // move to HOW TO PLAY
  await api.call("press", "Enter");
  await settle(api, 150);
  check.expectEq("HOW TO PLAY reaches the how-to-play screen", (await api.snapshot()).screen, "how-to-play");
  await api.screenshot("state");
  return check.verdict();
}
