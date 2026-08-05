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

// AND THE SURGE IS WALKING WHILE IT HAPPENS.
//
// The route lengths either side of the sell decide the verdict, and they are two numbers
// in a snapshot — so the old clip was a wall going up, a pause, the wall coming down, and
// a pause, with nothing on the floor to show what either did. `mazing.towers-are-walls`
// already films the other half of this pair by releasing Motes into its wall and letting
// a reviewer watch them take the long way round; this item is the same wall plus the
// selling, so it releases the same Motes. What the clip now shows is units grinding
// through a corridor, the wall vanishing under them, and the route they take straightening
// out — which is what "selling reopens the footprint and the surge re-paths" means.

import { newGame, build, spawn } from "../_helpers.mjs";

const WALL_A_ROWS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
const WALL_B_ROWS = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34];

export default function item() {
  let before;
  let walled;
  let after;
  let built = 0;
  const ids = [];

  return {
    id: "refund.reopens",

    // The wall goes up in `arrange`, so the clip opens on a floor that already has it;
    // what is filmed is the surge walking it, the sell, and the re-path.
    clipMs: 12000,

    // The baseline route length, measured on the empty floor before anything is built —
    // then the wall, and the surge released into it.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
      before = (await api.snapshot()).paths.left.length;

      for (const row of WALL_A_ROWS) ids.push(await build(api, "arc", 20, row));
      for (const row of WALL_B_ROWS) ids.push(await build(api, "arc", 24, row));
      // A refused placement comes back as null; the whole wall has to be there for the
      // lengthened reading — and for the sell-back — to mean anything.
      built = ids.filter((id) => id !== null).length;
      walled = (await api.snapshot()).paths.left.length;

      for (let i = 0; i < 3; i += 1) await spawn(api, "mote", "left");
      // Bring them up to the wall unfilmed, so the clip opens on units already working
      // their way through the corridor rather than on a minute of open floor.
      await api.skipUntil((s) => s.surge.some((u) => u.x > 300), {
        max: 1800,
        poll: 12,
      });
    },

    // Let the Motes walk the maze, sell the whole wall out from under them, and let them
    // re-path across the floor it reopened. Selling is an instant control op, so the two
    // advances either side of it are what make the change legible: without them the clip
    // is a wall and then no wall, with nothing between to show the surge reacting.
    async act(api) {
      await api.advance(150); // 2.5 s of the surge working through the maze

      for (const id of ids) {
        if (id !== null) await api.call("sellTower", id);
      }
      after = (await api.snapshot()).paths.left.length;

      await api.advance(240); // 4 s of the same units taking the reopened route
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
