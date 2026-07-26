// Automated validation for the Refund sub-item `reopens`.
//
// Selling a tower reopens every tile in its footprint and re-paths the surge
// (specs/towers.md), so a route it lengthened shortens again. We measure the left
// vent's route, wall the lane (lengthening it), then sell the wall and confirm the
// route returns to its original length.
//
// The wall is the offset pair `mazing.towers-are-walls` uses, for the reason spelled
// out there: the surge may step diagonally (specs/playfield.md), so a single straight
// wall leaves the tile-counted route unchanged, and the "it lengthened" precondition
// would then fail on a conformant build before this item ever reached the selling it
// exists to check.

import { newGame, build } from "../_helpers.mjs";

const WALL_A_ROWS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
const WALL_B_ROWS = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34];

export default function item() {
  let before;
  let walled;
  let after;
  let built = 0;

  return {
    id: "refund.reopens",

    // The baseline route length, measured on the empty floor before anything is built.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      before = (await api.snapshot()).paths.left.length;
    },

    // Wall the lane and then sell the wall back off. This IS the clip the old script
    // appended by hand: the route lengthens as the wall goes up and reopens as it
    // comes down. The two settles are what make that readable — building and selling
    // are instant control ops, so without a pause the clip would show only the end
    // state.
    async act(api) {
      const ids = [];
      for (const row of WALL_A_ROWS) ids.push(await build(api, "arc", 20, row));
      for (const row of WALL_B_ROWS) ids.push(await build(api, "arc", 24, row));
      // A refused placement comes back as null; the whole wall has to be there for the
      // lengthened reading — and for the sell-back — to mean anything.
      built = ids.filter((id) => id !== null).length;
      walled = (await api.snapshot()).paths.left.length;
      await api.settle(600);

      for (const id of ids) {
        if (id !== null) await api.call("sellTower", id);
      }
      after = (await api.snapshot()).paths.left.length;
      await api.settle(600);
    },

    async assert(api, check) {
      check.expectEq(
        "the whole wall was built",
        built,
        WALL_A_ROWS.length + WALL_B_ROWS.length,
      );
      check.expectGt("the wall lengthened the route", walled, before);
      check.expectEq(
        "selling the wall reopens the route to its original length",
        after,
        before,
      );
    },
  };
}
