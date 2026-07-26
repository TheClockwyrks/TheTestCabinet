// Automated validation for controls.fire-space: pressing Space fires a bolt straight
// up from the cursor. Injected input flows through the real key handling and the real
// updateFiring, and a bolt appears.

import { freshBoard, tileCX } from "../_helpers.mjs";

export default function item() {
  let boltsBefore;
  let boltsAfter;

  return {
    id: "controls.fire-space",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setCursor", tileCX(20), 688);
    },

    // Holding Space IS the clip. The bolt count is read before the key goes down and
    // again 6 ticks later — the verdict's whole window — after which the key stays
    // held purely so the recording shows a readable burst of fire.
    async act(api) {
      boltsBefore = (await api.snapshot()).bolts.length;
      await api.call("keyDown", "Space");
      await api.advance(6); // 6 ticks = the old 0.05s
      boltsAfter = (await api.snapshot()).bolts.length;
      // Both operands are captured; the remainder of the old clip's 800ms hold runs
      // on only to make the recording legible.
      await api.advance(90); // 90 ticks = the rest of the old 800ms held fire
      await api.call("keyUp", "Space");
    },

    async assert(api, check) {
      check.expectEq("no bolt before firing", boltsBefore, 0);
      check.expectGe("pressing Space fires a bolt", boltsAfter, 1);
    },
  };
}
