// Automated validation for the Conduction sub-item `hot-to-cold`.
//
// When two emitters touch, heat conducts from the hotter into the cooler across the
// shared edge (specs/heat.md). We place a hot Arc against a cold one, run the real
// heat model forward with no firing, and confirm the cold one heats up while the hot
// one cools — they converge.
//
// WHY THIS DOES NOT ASSERT THAT THE HOT ONE IS STILL HOTTER AFTERWARDS.
//
// It used to, and that assertion is unsatisfiable for a build implementing the spec's
// own conduction rate. Heat flows across the shared edge by `3.5 * sharedEdgeTiles`
// per degree of difference per second, each way (specs/heat.md); two touching 2x2
// Arcs share two edge-tiles and have mass 1.0, so the DIFFERENCE between them decays
// at `2 * 3.5 * 2 = 14` per second. Over the one second below that is a factor of
// `e^-14` — the 90-degree gap this scenario opens with is gone about six times over,
// and what is left is the build's floating-point residue, not a temperature.
//
// So "still hotter" was really asking which way a build's rounding fell, and
// specs/heat.md says the opposite of it in words: conduction "equalize[s] them", and
// "a dense block tends toward a single common temperature". Equalizing IS the pass
// condition. What the spec does pin, and what is asserted below, is the DIRECTION of
// the flow — the cool one gains, the hot one loses, and the cool one never overshoots
// past the hot one into a temperature nothing gave it — and that the pair arrives at a
// common temperature rather than drifting apart.

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
      // Direction: heat moved from the hot tower into the cool one and stopped there.
      // A build that overshoots — driving the cool neighbor PAST the tower feeding it —
      // is not conducting, so a half-degree of integration slop is the whole allowance.
      check.expectLe(
        "the cool neighbor never ends up hotter than the tower feeding it",
        c.heat,
        h.heat + 0.5,
      );
      // And they arrive at the "single common temperature" specs/heat.md describes.
      check.expectLt(
        "the pair converges on a common temperature",
        Math.abs(h.heat - c.heat),
        5,
      );
    },
  };
}
