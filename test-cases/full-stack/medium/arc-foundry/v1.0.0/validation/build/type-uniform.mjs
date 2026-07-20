// Automated validation for build.type-uniform: the component TYPE roll is uniform across the
// eight base types — over many re-seeded rolls, every one of the eight appears.

import { startBuild, towerAt, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("build.type-uniform");

  const types = new Set();
  for (let seed = 1; seed <= 48 && types.size < 8; seed += 1) {
    await startBuild(api, { seed });
    await api.call("setNextRoll", null);
    await api.call("placeRock", 6, 7);
    const t = towerAt(await snap(api), 6, 7);
    if (t) types.add(t.type);
  }

  check.expectEq("all eight base component types appear across many rolls", types.size, 8);

  await api.screenshot("types");
  return check.verdict();
}
