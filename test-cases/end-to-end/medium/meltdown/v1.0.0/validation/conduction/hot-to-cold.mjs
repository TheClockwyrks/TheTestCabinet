// Automated validation for the Conduction sub-item `hot-to-cold`.
//
// When two emitters touch, heat conducts from the hotter into the cooler across the
// shared edge (specs/heat.md). We place a hot Arc against a cold one, run the real
// heat model forward with no firing, and confirm the cold one heats up while the hot
// one cools — they converge.

import { newGame, build, tower } from "../_helpers.mjs";

export default function item() {
  let hotId;
  let coldId;
  let h;
  let c;

  return {
    id: "conduction.hot-to-cold",

    // Two touching Arcs at opposite extremes of the heat range. Nothing is spawned,
    // so conduction is the only thing moving heat between them.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      hotId = await build(api, "arc", 12, 12);
      coldId = await build(api, "arc", 12, 14); // touching the hot Arc's south face
      await api.call("setHeat", hotId, 90);
      await api.call("setHeat", coldId, 0);
    },

    // 60 ticks = the old 1s. The clip shows the two glows converging.
    async act(api) {
      await api.advance(60);
      h = await tower(api, hotId);
      c = await tower(api, coldId);
    },

    async assert(api, check) {
      check.expectGt("the cool neighbor heats up from conduction", c.heat, 5);
      check.expectLt("the hot tower cools toward its neighbor", h.heat, 90);
      check.expectGt(
        "the hot tower is still hotter than the cool one",
        h.heat,
        c.heat,
      );
    },
  };
}
