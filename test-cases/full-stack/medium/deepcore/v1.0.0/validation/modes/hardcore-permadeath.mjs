// Automated validation for modes.hardcore-permadeath.
//
// In Hardcore a death deletes the save (permadeath). We save at the surface in Hardcore, die, and
// confirm no save remains.

import { newRun, killByHull, SPAWN_COL, ROCKBED_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("modes.hardcore-permadeath");

  await newRun(api, { mode: "hardcore" });
  await api.call("save");
  check.expectEq("the expedition is saved", (await api.snapshot()).hasSave, true);

  const end = await killByHull(api, SPAWN_COL, ROCKBED_ROW);
  check.expectEq("a Hardcore death reaches Game Over", end.screen, "game-over");
  check.expectEq("the save is deleted on a Hardcore death", end.hasSave, false);

  await liveClip(api, 600);
  return check.verdict();
}
