// Automated validation for the Sealing sub-item `no-seal`.
//
// A placement that would leave a vent with no route to its exhaust is refused and
// shown invalid (specs/playfield.md). We wall column 25 top to bottom leaving a single
// two-tile gap at rows 16-17 — the last route across — then check that placing a
// tower to fill that gap is refused (canPlace false) and builds nothing.

import { newGame, build } from "../_helpers.mjs";

export default function item() {
  let countBefore;
  let countAfter;
  let can;

  return {
    id: "sealing.no-seal",

    // A full vertical wall at column 25 with a two-tile gap at rows 16-17 — the only
    // way across the floor left open.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      for (const row of [
        0, 2, 4, 6, 8, 10, 12, 14, 18, 20, 22, 24, 26, 28, 30, 32, 34,
      ]) {
        await build(api, "arc", 25, row);
      }
      countBefore = (await api.snapshot()).towers.length;
    },

    // Try to close the last gap, both through the validator and through the real
    // placement path, then let a frame land for the still.
    //
    // The preview is LEFT HELD OVER THE GAP for the still. A refusal is the absence of
    // a tower, and a screenshot of an absence is a screenshot of nothing: the frame was
    // a wall with a two-tile hole in it and no indication that anything had been tried
    // there, let alone refused. What the build draws instead is the invalid-footprint
    // highlight — "a valid/invalid footprint highlight (`#46d07a` valid, `#ff4d4d`
    // invalid)", shown for a footprint that "would seal the floor" (specs/controls.md)
    // — so arming the Arc and parking the preview on the gap puts the refusal itself in
    // the frame, in the colour the spec names for it.
    //
    // This is the one place `build`'s park-the-preview-elsewhere rule is deliberately
    // inverted (see `build` in `_helpers`): there the overlay would sit on a tower a
    // check wanted to sample, while here the overlay IS the evidence.
    async act(api) {
      can = await api.call("canPlace", "arc", 25, 16, 0);
      await api.call("placeTower", "arc", 25, 16, 0);
      countAfter = (await api.snapshot()).towers.length;

      await api.call("armTower", "arc");
      await api.call("movePreview", 25, 16);
      await api.settle(80);
      await api.screenshot("seal");
    },

    async assert(api, check) {
      check.expectEq("filling the last route is refused (invalid)", can, false);
      check.expectEq(
        "nothing is built by a sealing placement",
        countAfter,
        countBefore,
      );
    },
  };
}
