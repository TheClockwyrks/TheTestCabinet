// Automated validation for the Controls sub-item `pause-esc`.
//
// Esc pauses a live match when nothing is armed or selected (specs/controls.md).

import { newGame, press, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause-esc");

  await newGame(api, "containment", "medium");
  await press(api, "Escape");
  check.expectEq("Esc pauses the match", (await api.snapshot()).screen, "paused");

  await liveClip(api, 1400);
  return check.verdict();
}
