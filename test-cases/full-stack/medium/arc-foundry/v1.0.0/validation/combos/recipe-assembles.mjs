// Automated validation for combos.recipe-assembles: a recipe-combine folds a specific multiset
// of base (type, quality) ingredients into one combination tower at the initiating piece's
// footprint, and every consumed ingredient footprint hardens into a blocker.
//
// Assembling the recipe is all control ops (the arrange). The act reads the board the fold
// produced and then holds on it: a fresh-consuming recipe is the level's harvest, so Wave 1 is
// already running and the clip shows the assembled combo standing among its hardened
// ingredients, which is exactly what the assertions describe.

import { assembleCombo, towerById, snap, SECOND } from "../_helpers.mjs";

const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The fold's outputs and the board it left behind, all read by `assert`.
  let comboId;
  let ingredientIds;
  let s;

  return {
    id: "combos.recipe-assembles",

    async arrange(api) {
      ({ comboId, ingredientIds } = await assembleCombo(api, "fusecluster", { seed: 1, charge: 400 }));
    },

    async act(api) {
      s = await snap(api);
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectOk("a combination tower was assembled", comboId != null);

      const combo = towerById(s, comboId);
      check.expectEq("the assembled piece is a combo (single-grade, no quality tier)", combo.kind, "combo");
      check.expectEq("...of the expected recipe (Fuse Cluster)", combo.type, "fusecluster");

      const consumed = ingredientIds.filter((id) => id !== comboId).map((id) => towerById(s, id));
      check.expectOk(
        "every consumed ingredient footprint hardened into a blocker",
        consumed.length > 0 && consumed.every((b) => b && b.kind === "blocker"),
      );
    },
  };
}
