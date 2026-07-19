// Automated validation for the Progression item `lives`.
//
// A new run starts with three lives. Read straight from the snapshot after a fresh
// start, and capture the opening HUD. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("progression.lives");

  await startCrossing(api);
  check.expectEq("a new run starts with three lives", (await api.snapshot()).lives, 3);

  await api.wait(150);
  await api.screenshot("start");

  return check.verdict();
}
