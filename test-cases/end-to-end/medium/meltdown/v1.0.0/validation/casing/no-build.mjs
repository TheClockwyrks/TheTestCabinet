// Automated validation for the Casing sub-item `no-build`.
//
// No tower can be built off the tile grid onto the enclosing casing wall
// (specs/playfield.md). The grid is 50 columns wide (0..49); a 2x2 footprint at column
// 49 would run off the grid onto the casing, so it is refused — while a footprint
// wholly on the grid is allowed.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let offGrid;
  let onGrid;

  return {
    id: "casing.no-build",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
    },

    // Ask the real placement validator about both footprints, then let a frame land
    // so the captured still shows the floor and its casing.
    async act(api) {
      offGrid = await api.call("canPlace", "arc", 49, 18, 0); // cols 49,50 — 50 is casing
      onGrid = await api.call("canPlace", "arc", 20, 15, 0);
      await api.settle(80);
      await api.screenshot("casing");
    },

    async assert(api, check) {
      check.expectEq(
        "a footprint running off the grid onto the casing is refused",
        offGrid,
        false,
      );
      check.expectEq(
        "a footprint wholly on the floor grid is allowed",
        onGrid,
        true,
      );
    },
  };
}
