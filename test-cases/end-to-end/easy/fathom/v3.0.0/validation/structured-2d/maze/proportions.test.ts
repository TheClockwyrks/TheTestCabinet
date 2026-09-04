// maze/proportions — the three proportions are in range.
//
// specs/maze.md, under "Proportions": "Three measures fix how the maze reads.
// Each is computed over the corridor tiles alone, with the den interior and the
// den gate excluded from both the tiles measured and the neighbors counted. Both
// bounds of each are inclusive." The table it gives is the whole of the bound
// this point asserts, and the three figures below are the validator's own
// transcription of it, in `../constants` and never read off the build:
//
//   Openness      MAZE_OPENNESS_MIN (2.0)  ..  MAZE_OPENNESS_MAX (2.8)
//   Corridor run  MAZE_MAZING_MIN   (2.0)  ..  MAZE_MAZING_MAX   (8.0)
//   Density       MAZE_DENSITY_MIN  (0.40) ..  MAZE_DENSITY_MAX  (1.0)
//
// WHAT EACH ONE IS, in that file's own words. Openness is "the mean number of
// corridor neighbors per corridor tile". A corridor run is "a maximal group of
// corridor tiles that each have exactly two corridor neighbors and that are
// connected to one another as neighbors", its length "the number of tiles in it",
// and the measure "the mean length over every run in the maze". Density is "the
// number of corridor tiles divided by the number of cells inside the border,
// `(GRID_COLS - 2) * (GRID_ROWS - 2)`, which is `544`".
//
// THIS POINT NEVER STANDS DOWN. The other structural points defer on a layout
// with no corridor tile at all, because every count they take is zero on solid
// rock. This one is where that build is graded: a board with no corridor reads a
// density of `0` against a floor of `0.40`, and an openness of `0` against a
// floor of `2.0`.
//
// THREE MEASURES, ONE POINT, because specs/maze.md states them as one rule
// about how the maze reads: a board that is all junctions and a board that is a
// few long hallways both fail the same requirement, from opposite ends, and a
// build that misses it misses one thing rather than three.
//
// THE BOARD IS THE BUILD'S OWN, over several freshly seeded layouts, because
// finding the property in a board a build invented IS the check.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import {
  MAZE_DENSITY_MAX,
  MAZE_DENSITY_MIN,
  MAZE_MAZING_MAX,
  MAZE_MAZING_MIN,
  MAZE_OPENNESS_MAX,
  MAZE_OPENNESS_MIN,
} from "../constants";
import { createHarness, type Harness } from "../harness";
import { density, meanCorridorRun, openness } from "../maze";
import { captureBoard, freshBoards, witness } from "./boards";

/*
 * NO TOLERANCE IS ADDED TO THE BOUNDS. specs/maze.md states them as inclusive
 * figures and the review item names no margin, so what is compared is the measure
 * as it falls out of the layout. Inventing an epsilon here would pass a build the
 * specification does not.
 */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays out a maze whose openness, corridor run and density are all in range", async () => {
  const boards = freshBoards(h);

  const measured = boards.map((board) => {
    const open = openness(board.snapshot);
    const run = meanCorridorRun(board.snapshot);
    const fill = density(board.snapshot);
    return {
      board,
      open,
      run,
      fill,
      ok:
        open >= MAZE_OPENNESS_MIN &&
        open <= MAZE_OPENNESS_MAX &&
        run >= MAZE_MAZING_MIN &&
        run <= MAZE_MAZING_MAX &&
        fill >= MAZE_DENSITY_MIN &&
        fill <= MAZE_DENSITY_MAX,
    };
  });
  await captureBoard(h, witness(measured).board);

  for (const one of measured) {
    const seed = `the maze laid out from seed ${one.board.seed}`;
    assertBetween(
      one.open,
      MAZE_OPENNESS_MIN,
      MAZE_OPENNESS_MAX,
      `openness, the mean corridor neighbors per corridor tile, in ${seed}`,
    );
    assertBetween(
      one.run,
      MAZE_MAZING_MIN,
      MAZE_MAZING_MAX,
      `the mean corridor-run length, in tiles, in ${seed}`,
    );
    assertBetween(
      one.fill,
      MAZE_DENSITY_MIN,
      MAZE_DENSITY_MAX,
      `density, corridor tiles over the ` +
        `${(one.board.snapshot.grid.cols - 2) * (one.board.snapshot.grid.rows - 2)} ` +
        `cells inside the border, in ${seed}`,
    );
  }
});
