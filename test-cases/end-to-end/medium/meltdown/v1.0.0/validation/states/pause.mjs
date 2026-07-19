// Automated validation for the States sub-item `pause`.
//
// The pause state is reachable, offering resume, restart, and quit (specs/states.md).
// We start a match and pause it, then capture the pause menu.

import { newGame, press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.pause");
  await newGame(api, "containment", "medium");
  await press(api, "KeyP");
  await api.wait(120);
  check.expectEq("the match pauses", (await api.snapshot()).screen, "paused");
  await api.screenshot("pause");
  return check.verdict();
}
