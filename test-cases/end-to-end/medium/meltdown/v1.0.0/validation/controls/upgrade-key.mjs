// Automated validation for the Controls sub-item `upgrade-key`.
//
// U upgrades the selected placed tower one level (specs/controls.md). We place and
// select a tower, press U, and read its level rise.

import { newGame, build, tower, press, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.upgrade-key");

  await newGame(api, "containment", "medium", 100000);
  const id = await build(api, "arc", 10, 10);
  await api.call("selectTower", id);
  check.expectEq("the tower starts at level 1", (await tower(api, id)).level, 1);
  await press(api, "KeyU");
  check.expectEq("U upgrades it to level 2", (await tower(api, id)).level, 2);

  await liveClip(api, 1400);
  return check.verdict();
}
