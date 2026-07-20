// Automated validation for the Forge sub-item `warms`.
//
// A Forge touching a cold emitter warms it up over time (specs/heat.md). A cold Arc
// is placed against a Forge and the real heat model is run forward with no target —
// its heat must rise from cold.

import { newGame, build, heatOf } from "../_helpers.mjs";

export default function item() {
  let arcId;
  let before;
  let after;

  return {
    id: "forge.warms",

    // A cold Arc with a Forge on its south face. Nothing is spawned, so the Forge is
    // the only thing that can move its heat.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      arcId = await build(api, "arc", 12, 12);
      await build(api, "forge", 12, 14); // touching the Arc's south face
      await api.call("setHeat", arcId, 0);
    },

    // 120 ticks = the old 2s. No target: only the Forge acts, and the clip shows the
    // Arc's glow coming up from cold.
    async act(api) {
      before = await heatOf(api, arcId);
      await api.advance(120);
      after = await heatOf(api, arcId);
    },

    async assert(api, check) {
      check.expectClose("the emitter starts cold", before, 0, 0.01);
      check.expectGt("a Forge warms a cold gun", after, 5);
    },
  };
}
