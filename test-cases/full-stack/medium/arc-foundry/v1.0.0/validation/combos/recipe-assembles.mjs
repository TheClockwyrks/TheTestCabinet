// Automated validation for combos.recipe-assembles: a recipe-combine folds a specific multiset
// of base (type, quality) ingredients into one combination tower at the initiating piece's
// footprint, and every consumed ingredient footprint hardens into a blocker.

import { assembleCombo, towerById, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("combos.recipe-assembles");

  const { comboId, ingredientIds } = await assembleCombo(api, "fusecluster", { seed: 1, charge: 400 });
  const s = await snap(api);
  check.expectOk("a combination tower was assembled", comboId != null);

  const combo = towerById(s, comboId);
  check.expectEq("the assembled piece is a combo (single-grade, no quality tier)", combo.kind, "combo");
  check.expectEq("...of the expected recipe (Fuse Cluster)", combo.type, "fusecluster");

  const consumed = ingredientIds.filter((id) => id !== comboId).map((id) => towerById(s, id));
  check.expectOk("every consumed ingredient footprint hardened into a blocker", consumed.length > 0 && consumed.every((b) => b && b.kind === "blocker"));

  await liveClip(api);
  return check.verdict();
}
