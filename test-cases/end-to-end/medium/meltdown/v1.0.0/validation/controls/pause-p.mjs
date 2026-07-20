// Automated validation for the Controls sub-item `pause-p`.
//
// P pauses a live match (specs/controls.md).

import { newGame, press, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause-p");

  await newGame(api, "containment", "medium");
  await press(api, "KeyP");
  check.expectEq("P pauses the match", (await api.snapshot()).screen, "paused");

  await liveClip(api, 1400);
  return check.verdict();
}
