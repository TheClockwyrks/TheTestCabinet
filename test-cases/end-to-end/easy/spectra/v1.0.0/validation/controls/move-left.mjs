// Automated validation for the Controls sub-item `move-left`.
//
// Holding Left (or A) moves the ship left. The match is entered and the key held
// through injected input; the real ship update, stepped forward, moves it, and the
// displacement is read back. Both bindings are checked.

import { startClean, actHoldMoveX } from "../_helpers.mjs";

export default function item() {
  // The displacement each binding produced.
  let arrow;
  let a;

  return {
    id: "controls.move-left",

    // A clean wave with the ship at centre, far enough from the left bound that a
    // short hold cannot be cut short by the clamp (which `move-clamp` covers).
    async arrange(api) {
      await startClean(api);
      await api.call("setShipX", 640);
    },

    async act(api) {
      // `actHoldMoveX` captures the displacement after exactly its measured window
      // and only then holds a further readable moment for the clip, so the extra
      // travel the reviewer sees can never leak into `dx`.
      arrow = await actHoldMoveX(api, "ArrowLeft");

      // Re-pose to centre for the second binding with a control op rather than the
      // `startClean` the old script used: `reset` is forbidden in `act` because it
      // would take the clock back and freeze the recording.
      await api.call("setShipX", 640);
      a = await actHoldMoveX(api, "KeyA");
    },

    async assert(api, check) {
      check.expectLt("holding ArrowLeft moves the ship left", arrow.dx, -50);
      check.expectLt("holding A moves the ship left", a.dx, -50);
    },
  };
}
