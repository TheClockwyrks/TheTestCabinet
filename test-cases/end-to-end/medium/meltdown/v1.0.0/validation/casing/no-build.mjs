// Automated validation for the Casing sub-item `no-build`.
//
// No tower can be built off the tile grid onto the enclosing casing wall
// (specs/playfield.md). The grid is 50 columns wide (0..49); a 2x2 footprint at column
// 49 would run off the grid onto the casing, so it is refused — while a footprint
// wholly on the grid is allowed.
//
// THE STILL SHOWS A TOWER HELD AT THE EDGE, NOT AN EMPTY FLOOR.
//
// It used to be a screenshot of the bare playfield with its casing drawn round it, taken
// while nothing was held. That is a picture of the wall, not of the rule: a floor with
// no tower on the casing is equally a floor nobody tried to build on, and the whole
// content of the item — that the game will not let you put one there — was off-screen.
//
// So the preview is armed and driven AT the edge, and the still is taken with the
// footprint sitting against the casing. What that frame shows is the behaviour
// `specs/controls.md` describes: the held footprint "centers on the cursor, KEPT FULLY
// ON THE GRID", so it comes to rest hard against the wall rather than hanging over it.
// A build that instead lets the footprint slide out over the casing and paints it red
// there is visibly doing something else, and a reviewer can see which at a glance.
//
// The stopping itself is deliberately NOT asserted. `movePreview(col, row)` is specified
// as putting the footprint's top-left at `(col, row)` with "the preview's valid/invalid
// state updat[ing] through the real placement check" (specs/instrumentation.md), which
// admits both readings — clamp the preview to the grid, or hold it where it was put and
// report it invalid — and the two are indistinguishable from a snapshot without picking
// one. The mechanical claim is the one both readings agree on and that `canPlace`
// answers directly: an off-grid footprint cannot be built. The frame is for the rest.

import { newGame } from "../_helpers.mjs";

// A 2x2 at column 49 covers columns 49 and 50, and 50 is casing — the smallest possible
// overhang, which is the interesting case. Row 18 puts it on the vent rows, where the
// casing's opening is, so the frame also shows that an opening is not a hole in the rule.
const OFF_GRID = [49, 18];

// The rightmost 2x2 footprint that IS wholly on the grid, one column back.
const LAST_ON_GRID = [48, 18];

// Somewhere unambiguously mid-floor, as the control.
const MID_FLOOR = [20, 15];

export default function item() {
  let offGrid;
  let onGrid;
  let held;

  return {
    id: "casing.no-build",

    // Ask the real placement validator about both footprints, then drive the held
    // preview out to the edge and let a frame land there.
    async act(api) {
      offGrid = await api.call("canPlace", "arc", OFF_GRID[0], OFF_GRID[1], 0);
      onGrid = await api.call("canPlace", "arc", MID_FLOOR[0], MID_FLOOR[1], 0);

      // Walk the preview out to the wall: the last footprint that fits, then a push
      // past it. Where the build leaves it is what the still records.
      await api.call("armTower", "arc");
      await api.call("movePreview", LAST_ON_GRID[0], LAST_ON_GRID[1]);
      await api.settle(80);
      await api.call("movePreview", OFF_GRID[0], OFF_GRID[1]);
      held = (await api.snapshot()).build;
      await api.settle(120);
      await api.screenshot("casing");
    },

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
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
      // Whichever reading the build takes of `movePreview` at the edge, the footprint it
      // ends up holding has to be one it would not build: either it clamped back onto
      // the grid (and is valid there), or it is out over the casing and reads invalid.
      // What it must never be is off-grid AND valid.
      check.expectOk(
        `the held preview at the edge is not an off-grid placement it would accept (col ${held ? held.col : "none"}, valid ${held ? held.valid : "none"})`,
        Boolean(held) && (held.col <= LAST_ON_GRID[0] || held.valid === false),
      );
    },
  };
}
