// Automated validation for the Controls sub-item `sell-key`.
//
// S sells the selected placed tower (specs/controls.md). We place and select a tower,
// press S, and confirm it is removed.

import { newGame, build, tower, press, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.sell-key");

  await newGame(api, "containment", "medium", 100000);
  const id = await build(api, "arc", 10, 10);
  await api.call("selectTower", id);
  check.expectOk("the tower is placed", (await tower(api, id)) !== null);
  await press(api, "KeyS");
  check.expectOk("S sells (removes) the selected tower", (await tower(api, id)) === null);

  await liveClip(api, 1400);
  return check.verdict();
}
