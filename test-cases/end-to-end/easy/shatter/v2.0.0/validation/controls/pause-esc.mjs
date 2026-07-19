// Automated validation for the Controls item `pause-esc`: Esc pauses the game. A real game
// is in play; pressing Esc must move it to the paused state.

import { newGame, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.pause-esc");

  await newGame(api);
  check.expectEq("the game is in play before pausing", (await api.snapshot()).screen, "playing");

  await api.call("press", "Escape");
  check.expectEq("pressing Esc pauses the game", (await api.snapshot()).screen, "paused");

  await liveClip(api, 600);
  return check.verdict();
}
