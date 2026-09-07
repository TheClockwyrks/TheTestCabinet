// maze/no-dead-ends — no dead ends.
//
// specs/maze.md, under "A conforming maze": "No dead ends. Every corridor tile
// has at least two corridor neighbors, so the forager passes through a tile and
// comes back around another way."
//
// The reading counts, for every corridor tile, how many of its neighbors are
// corridor, and the bound is two. "A corridor neighbor of a tile is a neighbor of
// it that is a corridor tile", and the two wrap-tunnel mouths are neighbors of
// each other, so a mouth's neighbor across the border counts exactly like any
// other — a tunnel mouth with corridor on one side only is NOT a dead end, and a
// reading that stopped at the border would wrongly say it was.
//
// THE DEN IS NOT CORRIDOR, so a chamber tile is neither counted as a dead end nor
// counted as anyone's corridor neighbor. A gate with corridor above it and den
// below has one corridor neighbor and is still not a dead end, because it is not
// a corridor tile.
//
// THE BOARD IS THE BUILD'S OWN, over several freshly laid-out layouts, because
// finding the property in a board a build invented IS the check.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { deadEnds } from "../maze";
import { captureBoard, freshBoards, requireLaidOut, witness } from "./boards";

/**
 * How many corridor tiles a conforming layout may leave with fewer than two
 * corridor neighbors.
 *
 * None: specs/maze.md states the rule of "every corridor tile".
 */
const MAX_DEAD_ENDS = 0;

/** How many offending tiles a failure names before it trails off. */
const NAMED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays out a braided maze, with at least two corridor neighbors on every corridor tile", async () => {
  const boards = freshBoards(h);
  requireLaidOut(boards);

  const measured = boards.map((board) => {
    const ends = deadEnds(board.snapshot);
    return { board, ends, ok: ends.length === MAX_DEAD_ENDS };
  });
  await captureBoard(h, witness(measured).board);

  for (const one of measured) {
    const named = one.ends
      .slice(0, NAMED)
      .map((tile) => `(${tile.tx}, ${tile.ty})`)
      .join(", ");
    assertEqual(
      one.ends.length,
      MAX_DEAD_ENDS,
      `corridor tiles with fewer than two corridor neighbors in the maze laid ` +
        `out from board ${one.board.ordinal}` +
        (named === "" ? "" : `, at ${named}`),
    );
  }
});
