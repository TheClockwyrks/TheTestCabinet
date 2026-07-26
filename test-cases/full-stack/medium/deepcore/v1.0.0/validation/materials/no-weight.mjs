// Automated validation for materials.no-weight.
//
// An exotic material rides in the satchel — it adds no cargo slot and no load weight. We bank a
// Resonite through the real collection path and confirm the cargo bay is unchanged.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "materials.no-weight",

    async arrange(api) {
      await newRun(api);
      before = await api.snapshot();
    },

    // Banking the material IS the behavior, so it happens here and the clip shows the cargo readout
    // staying put while the satchel fills.
    async act(api) {
      await api.call("giveMaterial", "resonite");
      after = await api.snapshot();
      await api.advance(24); // 24 ticks = 0.4 s, the old 400 ms clip tail
    },

    async assert(api, check) {
      check.expectEq(
        "the material is in the satchel",
        after.satchel.resonite,
        1,
      );
      check.expectEq(
        "it uses no cargo slot",
        after.cargo.slotsUsed,
        before.cargo.slotsUsed,
      );
      check.expectEq(
        "it adds no load weight",
        after.cargo.loadKg,
        before.cargo.loadKg,
      );
    },
  };
}
