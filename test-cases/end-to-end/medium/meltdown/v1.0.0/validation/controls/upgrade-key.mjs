// Automated validation for the Controls sub-item `upgrade-key`.
//
// U upgrades the selected placed tower one level (specs/controls.md). We place and
// select a tower, press U, and read its level rise.

import { newGame, build, tower, press, actTail } from "../_helpers.mjs";

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
      // A LEAD-IN BEFORE THE PRESS. `act` is where the record pass starts filming, so
      // with the key press as its first statement the clip opened on the frame the state
      // had already changed — a reviewer saw the AFTER and had nothing to compare it to,
      // which for a toggle is no evidence at all. Two seconds of the before state first
      // is what makes the change on screen legible as a change. It costs the verdict
      // nothing: the reading below is still taken on the press itself.
      await actTail(api, 120); // 2 s of the state the press is about to leave
      before = (await tower(api, id)).level;
      await press(api, "KeyU");
      after = (await tower(api, id)).level;

      // A key press and the state it leaves behind both resolve instantly, so without
      // this the clip is a still frame of a game that never visibly does anything —
      // three seconds of the result on screen is what makes it reviewable.
      await actTail(api, 180);
    },

    async assert(api, check) {
      check.expectEq("the tower starts at level 1", before, 1);
      check.expectEq("U upgrades it to level 2", after, 2);
    },
  };
}
