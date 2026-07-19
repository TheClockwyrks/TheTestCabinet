// Automated validation for the Presentation sub-item `state-playing`: the live table
// is reachable, and the debug API captures it. A fresh deal enters play; the screen
// is read back and the dealt table captured. Whether the table reads and lays out
// well is judged by eye from the capture.

import { deal } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-playing");

  const s = await deal(api, 8);
  check.expectEq("a new game enters the live table", s.screen, "playing");
  await api.wait(120);
  await api.screenshot("playing");

  return check.verdict();
}
