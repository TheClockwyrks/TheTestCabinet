// Automated validation for the Controls sub-item `upgrade-key`.
//
// U upgrades the selected placed tower one level (specs/controls.md). We place and
// select a tower, press U, and read its level rise.

import { newGame, build, tower, press } from "../_helpers.mjs";

export default function item() {
  let id;
  let before;
  let after;

  return {
    id: "controls.upgrade-key",

    // A placed, selected tower — U acts on the selection, so there has to be one.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      id = await build(api, "arc", 10, 10);
      await api.call("selectTower", id);
    },

    async act(api) {
      before = (await tower(api, id)).level;
      await press(api, "KeyU");
      after = (await tower(api, id)).level;
    },

    async assert(api, check) {
      check.expectEq("the tower starts at level 1", before, 1);
      check.expectEq("U upgrades it to level 2", after, 2);
    },
  };
}
