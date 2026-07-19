// Shift: every level begins with exactly three lives.

import { startFresh, settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("shift.three-lives");

  await startFresh(api, 1);
  check.expectEq("level 1 starts with three lives", (await api.snapshot()).level.lives, 3);
  await settle(api, 150);
  await api.screenshot("hud");

  await api.call("startLevel", 4);
  check.expectEq("level 4 also starts with three lives", (await api.snapshot()).level.lives, 3);

  return check.verdict();
}
