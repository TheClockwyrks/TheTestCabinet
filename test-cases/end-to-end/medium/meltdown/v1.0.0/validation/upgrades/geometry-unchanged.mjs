// Automated validation for the Upgrades sub-item `geometry-unchanged`.
//
// Upgrading leaves an emitter's footprint size, redline, and radiator layout the
// same — only its power and heat grow (specs/towers.md). We read an Arc's size,
// redline, and radiator faces before and after upgrading it to level III.

import { newGame, build, tower } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("upgrades.geometry-unchanged");

  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  const before = await tower(api, arc);
  await api.call("upgradeTower", arc);
  await api.call("upgradeTower", arc);
  const after = await tower(api, arc);

  check.expectEq("the tower reached level III", after.level, 3);
  check.expectEq("footprint size is unchanged", after.size, before.size);
  check.expectEq("redline is unchanged", after.redline, before.redline);
  check.expectEq("radiator faces are unchanged", after.radiatorFaces.join(","), before.radiatorFaces.join(","));

  await api.wait(80);
  await api.screenshot("geometry");
  return check.verdict();
}
