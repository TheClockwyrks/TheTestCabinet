// Automated validation for the Controls sub-item `sell-key`.
//
// S sells the selected placed tower (specs/controls.md). We place and select a tower,
// press S, and confirm it is removed.

import { newGame, build, tower, press, actTail } from "../_helpers.mjs";

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
      // A LEAD-IN BEFORE THE PRESS. `act` is where the record pass starts filming, so
      // with the key press as its first statement the clip opened on the frame the state
      // had already changed — a reviewer saw the AFTER and had nothing to compare it to,
      // which for a toggle is no evidence at all. Two seconds of the before state first
      // is what makes the change on screen legible as a change. It costs the verdict
      // nothing: the reading below is still taken on the press itself.
      await actTail(api, 120); // 2 s of the state the press is about to leave
      placed = (await tower(api, id)) !== null;
      await press(api, "KeyS");
      sold = (await tower(api, id)) === null;

      // A key press and the state it leaves behind both resolve instantly, so without
      // this the clip is a still frame of a game that never visibly does anything —
      // three seconds of the result on screen is what makes it reviewable.
      await actTail(api, 180);
    },

    async assert(api, check) {
      check.expectOk("the tower is placed", placed);
      check.expectOk("S sells (removes) the selected tower", sold);
    },
  };
}
