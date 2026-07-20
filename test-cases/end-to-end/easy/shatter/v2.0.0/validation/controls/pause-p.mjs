// Automated validation for the Controls item `pause-p`: the P key pauses the game (the
// alternate pause binding). A real game is in play; pressing P must move it to paused.

import { newGame, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause-p");

  await newGame(api);
  check.expectEq("the game is in play before pausing", (await api.snapshot()).screen, "playing");

  await api.call("press", "KeyP");
  check.expectEq("pressing P pauses the game", (await api.snapshot()).screen, "paused");

  await liveClip(api, 600);
  return check.verdict();
}
