// Automated validation for combos.lands-level0: a newly assembled combination tower lands at
// upgrade level 0 (its reduced landing block), so assembling it is a step up, not a cliff.
//
// Assembling the recipe is all control ops (the arrange). The act reads the freshly landed
// combo and holds on it — a fresh-consuming recipe is the level's harvest, so Wave 1 is already
// running and the clip shows the new combo taking its first shots at level 0.

import { assembleCombo, towerById, snap, SECOND } from "../_helpers.mjs";

// Long enough for the launched wave to reach the combo and for it to fire.
const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The combo id, and the tower as it landed, read by `assert`.
  let comboId;
  let c;

  return {
    id: "combos.lands-level0",

    async arrange(api) {
      ({ comboId } = await assembleCombo(api, "fusecluster", { seed: 1, charge: 400 }));
    },

    async act(api) {
      c = towerById(await snap(api), comboId);
      await api.advance(CLIP_TICKS);
      await api.screenshot("level0");
    },

    async assert(api, check) {
      check.expectEq("a freshly assembled combo lands at upgrade level 0", c.level, 0);
    },
  };
}
