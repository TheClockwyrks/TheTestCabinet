// Automated validation for the Controls sub-item `sell-key`.
//
// S sells the selected placed tower (specs/controls.md). We place and select a tower,
// press S, and confirm it is removed.

import { newGame, build, tower, press } from "../_helpers.mjs";

export default function item() {
  let id;
  let placed;
  let sold;

  return {
    id: "controls.sell-key",

    // A placed, selected tower — S acts on the selection, so there has to be one.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      id = await build(api, "arc", 10, 10);
      await api.call("selectTower", id);
    },

    async act(api) {
      placed = (await tower(api, id)) !== null;
      await press(api, "KeyS");
      sold = (await tower(api, id)) === null;
    },

    async assert(api, check) {
      check.expectOk("the tower is placed", placed);
      check.expectOk("S sells (removes) the selected tower", sold);
    },
  };
}
