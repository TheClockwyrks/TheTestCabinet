// Automated validation for modes.credits-survive.
//
// Credits already banked survive a death. We bank Credits, die, and confirm the balance is intact
// on the Game Over screen.

import { newRun, killByHull, SPAWN_COL, ROCKBED_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("modes.credits-survive");

  await newRun(api, { mode: "standard" });
  await api.call("grantCredits", 500);

  const end = await killByHull(api, SPAWN_COL, ROCKBED_ROW);
  check.expectEq("the run ended", end.screen, "game-over");
  check.expectEq("banked Credits survive the death", end.credits, 500);

  await liveClip(api, 600);
  return check.verdict();
}
