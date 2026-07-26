// Automated validation for the Drones sub-item `inversion-trigger`.
//
// A diving Prism that crosses the bottom of the play field unbroken triggers a
// spectral inversion (rather than being destroyed) and returns toward its slot. A
// Prism is driven into a real exit dive to the bottom (arrangeInversion/
// actInversion); the inversion turning on, and the Prism surviving and returning,
// are read back.

import { arrangeInversion, actInversion, findDrone } from "../_helpers.mjs";

export default function item() {
  // The inversion drive's outcome.
  let r;

  return {
    // As in `inversion-swap`: whether a dive exits through the bottom is an RNG roll
    // taken at launch, and a losing attempt can burn up to 5 s, so the default 8 s
    // budget risks the clip ending before the trigger this item is named for. 10 s
    // leaves room for a second attempt. The validate pass is uncapped, so no verdict
    // depends on this.
    clipMs: 10000,

    id: "drones.inversion-trigger",

    // A clean, seeded stage-1 wave with an empty field, ready for the drive.
    async arrange(api) {
      await arrangeInversion(api);
    },

    // The dive to the bottom IS the behavior and IS the clip: the reviewer watches
    // the Prism plunge, the field invert, and the Prism loop back rather than pop.
    async act(api) {
      r = await actInversion(api);
      await api.advance(120); // 120 ticks (1 s) so the return leg is visible
    },

    async assert(api, check) {
      check.expectOk(
        "a Prism reaching the bottom triggers a spectral inversion",
        r.hit && r.snap.inversionActive,
      );
      const d = r.id != null ? findDrone(r.snap, r.id) : null;
      check.expectOk("the Prism is not destroyed by triggering it", d !== null);
      if (d) {
        check.expectOk(
          "the Prism returns toward its slot after triggering",
          d.phase === "returning" || d.phase === "formation",
        );
      }
    },
  };
}
