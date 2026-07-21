// Automated validation for the Controls sub-item `move-right`.
//
// Holding Right (or D) moves the ship right. The key is held through injected input
// and the real ship update stepped forward; the displacement is read back. Both
// bindings are checked.

import { startClean, actHoldMoveX } from "../_helpers.mjs";

export default function item() {
  // The displacement each binding produced.
  let arrow;
  let d;

  return {
    id: "controls.move-right",

    // A clean wave with the ship at centre, far enough from the right bound that a
    // short hold cannot be cut short by the clamp (which `move-clamp` covers).
    async arrange(api) {
      await startClean(api);
      await api.call("setShipX", 640);
    },

    async act(api) {
      // `actHoldMoveX` captures the displacement after exactly its measured window
      // and only then holds a further readable moment for the clip, so the extra
      // travel the reviewer sees can never leak into `dx`.
      arrow = await actHoldMoveX(api, "ArrowRight");

      // Re-pose to centre for the second binding with a control op rather than the
      // `startClean` the old script used: `reset` is forbidden in `act` because it
      // would take the clock back and freeze the recording.
      await api.call("setShipX", 640);
      d = await actHoldMoveX(api, "KeyD");
    },

    async assert(api, check) {
      check.expectGt("holding ArrowRight moves the ship right", arrow.dx, 50);
      check.expectGt("holding D moves the ship right", d.dx, 50);
    },
  };
}
