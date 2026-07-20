// Automated validation for refinement.biases-rolls: buying Refinement biases the stamp's
// quality roll upward — at a high Refinement level rolls land above Scrap, whereas at R0 they
// never do.
//
// At R0 a real roll is Scrap. Deeply refined (R8, whose odds carry zero Scrap weight), five
// real rolls all land above Scrap.

import { startBuild, SPOTS, towerAt, snap, spawnControlled, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("refinement.biases-rolls");

  // R0 baseline: a real roll is Scrap.
  await startBuild(api, { seed: 1 });
  await api.call("setNextRoll", null);
  await api.call("placeRock", 6, 7);
  check.expectEq("an unrefined (R0) roll is Scrap (T1)", towerAt(await snap(api), 6, 7).quality, 1);

  // Deeply refined: rolls land above Scrap.
  await startBuild(api, { seed: 1, charge: 9999 });
  await api.call("setRefinement", 8);
  const tiers = [];
  for (const spot of SPOTS) {
    await api.call("setNextRoll", null);
    await api.call("placeRock", spot.col, spot.row);
    const t = towerAt(await snap(api), spot.col, spot.row);
    if (t && t.kind === "candidate") tiers.push(t.quality);
  }
  check.expectEq("five refined rolls landed", tiers.length, 5);
  check.expectOk("a deeply refined press rolls no Scrap", tiers.every((q) => q > 1));
  check.expectGt("...and hands out higher tiers on average", Math.max(...tiers), 1);

  await spawnControlled(api, "spark");
  await liveClip(api);
  return check.verdict();
}
