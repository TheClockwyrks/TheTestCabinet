// Automated validation for the Surface-cooling sub-item `open-faces-shed`.
//
// A hot tower with faces on open air sheds heat over time (specs/heat.md). A lone
// emitter is posed hot as a precondition, then the real cooling model is run forward
// with no target — its heat must fall.

import { newGame, build, heatOf } from "../_helpers.mjs";

export default function item() {
  let towerId;
  let before;
  let after;

  return {
    id: "cooling.open-faces-shed",

    // A lone Arc out in open floor, posed hot. Nothing is spawned, so nothing can
    // heat it back up — the only thing acting on it is surface cooling.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      towerId = await build(api, "arc", 20, 12);
      await api.call("setHeat", towerId, 80);
    },

    // 120 ticks = the old 2s. No target: the tower only cools, and the clip shows its
    // glow dimming as it does.
    async act(api) {
      before = await heatOf(api, towerId);
      await api.advance(120);
      after = await heatOf(api, towerId);
    },

    async assert(api, check) {
      check.expectClose("the emitter starts hot", before, 80, 0.5);
      check.expectLt("a lone hot emitter sheds heat over time", after, before);
    },
  };
}
