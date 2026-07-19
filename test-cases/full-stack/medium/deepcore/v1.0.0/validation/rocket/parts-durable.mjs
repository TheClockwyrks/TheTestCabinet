// Automated validation for rocket.parts-durable.
//
// Rocket components already installed stay installed across a death. We fabricate two parts, cause a
// death, and confirm they are still installed on the Game Over screen.

import { newRun, killByHull, SPAWN_COL, ROCKBED_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rocket.parts-durable");

  await newRun(api);
  await api.call("grantCredits", 15000);
  await api.call("fabricate"); // hull-frame
  await api.call("fabricate"); // fuel-cells
  check.expectEq("two parts are installed before the death", (await api.snapshot()).rocket.installed.length, 2);

  const end = await killByHull(api, SPAWN_COL, ROCKBED_ROW);
  check.expectEq("the run ended", end.screen, "game-over");
  check.expectOk("the Hull Frame survives the death", end.rocket.installed.includes("hull-frame"));
  check.expectOk("the Fuel Cells survive the death", end.rocket.installed.includes("fuel-cells"));

  await liveClip(api, 600);
  return check.verdict();
}
