// Automated validation for modes.standard-restore.
//
// In Standard a death keeps the single save, so Game Over offers Continue From Save and restoring
// resumes the expedition. We save at the surface, die, confirm the save survived and Game Over, then
// take the Continue option and confirm play resumes.

import { newRun, killByHull, press, SPAWN_COL, ROCKBED_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("modes.standard-restore");

  await newRun(api, { mode: "standard" });
  await api.call("save"); // at the surface
  check.expectEq("the expedition is saved", (await api.snapshot()).hasSave, true);

  const end = await killByHull(api, SPAWN_COL, ROCKBED_ROW);
  check.expectEq("a Standard death reaches Game Over", end.screen, "game-over");
  check.expectEq("the save survives a Standard death", end.hasSave, true);

  await press(api, "Enter"); // Continue From Save (the first Game Over option)
  check.expectEq("restoring resumes the expedition", (await api.snapshot()).screen, "in-mine");

  await liveClip(api, 600);
  return check.verdict();
}
