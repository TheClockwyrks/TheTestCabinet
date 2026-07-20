// Automated validation for build.r0-only-scrap: at Refinement R0 every placed rock rolls
// Scrap (T1) quality — the unrefined press hands out only the lowest tier.
//
// Five rocks are placed at R0 with the real seeded press; every rolled candidate's quality
// must be Scrap.

import { startBuild, SPOTS, towerAt, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("build.r0-only-scrap");

  const s0 = await startBuild(api); // Refinement starts at R0
  check.expectEq("the press starts at Refinement R0", s0.refinement, 0);

  const tiers = [];
  for (const spot of SPOTS) {
    await api.call("setNextRoll", null);
    await api.call("placeRock", spot.col, spot.row);
  }
  const s = await snap(api);
  for (const spot of SPOTS) {
    const t = towerAt(s, spot.col, spot.row);
    if (t && t.kind === "candidate") tiers.push(t.quality);
  }

  check.expectEq("five R0 rolls landed", tiers.length, 5);
  check.expectOk("every R0 roll is Scrap (T1)", tiers.every((q) => q === 1));

  await api.screenshot("scrap");
  return check.verdict();
}
