// maze/den-reachable — a released predator can reach the forager.
//
// specs/maze.md, under "A conforming maze": "A reachable den. Following
// neighbors that are corridor, den-interior or den-gate tiles, the forager's
// start tile is reachable from every den-interior tile, so a predator that leaves
// the den can reach the forager."
//
// THE GRAPH IS THE PREDATORS', NOT THE FORAGER'S. specs/maze.md's tile table
// gives the den interior and the gate to the predators and gives the forager
// neither, so the flood here runs over `.`, `d` and `g` alike, wrap tunnel
// included. That makes this a different question from `maze/connected`, which
// floods corridor alone: a board whose corridors all join up can still have a
// chamber sealed off from them, and that board passes there and fails here.
//
// THE FLOOD RUNS FROM THE FORAGER'S START TILE, and the reading is how many
// den-interior tiles it failed to reach. Reachability over this graph is
// symmetric, so one sweep decides "the forager's start tile is reachable from
// EVERY den-interior tile" — including the case the other direction misses, a
// chamber split in two with only half of it connected.
//
// AND THIS POINT NEVER STANDS DOWN. The two points about the chamber's shape
// defer on a layout that marks no den interior, because neither has anything to
// decide without one. This one is where that build is graded.
//
// AND THE CHAMBER HAS TO BE THERE. specs/maze.md builds the chamber out of
// den-interior tiles, and a layout that marks none of them has no den for a
// predator to leave, so no predator can reach the forager and the point fails
// rather than passing on an empty sweep. That is this point's to say: it is the
// one that asks whether a released hunter can get to the player at all.
//
// THE BOARD IS THE BUILD'S OWN, over several freshly seeded layouts, because
// finding the property in a board a build invented IS the check.

import { afterEach, beforeEach } from "vitest";
import { check } from "../scene";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { denTiles, predatorReachable } from "../maze";
import { captureBoard, freshBoards, witness } from "./boards";

/**
 * How many den-interior tiles the chamber a released predator comes out of is
 * made of, at the least.
 *
 * One: specs/maze.md has "A single open chamber near the grid center" that is
 * "made of den-interior tiles".
 */
const MIN_DEN_TILES = 1;

/** How many den-interior tiles the flood may fail to reach. */
const MAX_UNREACHED = 0;

/** How many unreached tiles a failure names before it trails off. */
const NAMED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check(
  "joins the den to the forager's start over the tiles a predator may enter",
  async () => {
    const boards = freshBoards(h);

    const measured = boards.map((board) => {
      const start = board.snapshot.forager;
      const den = denTiles(board.snapshot);
      const reach = predatorReachable(board.snapshot, [
        { tx: start.tx, ty: start.ty },
      ]);
      const unreached = den.filter(
        (tile) => !reach.has(`${tile.tx},${tile.ty}`),
      );
      return {
        board,
        start,
        den,
        unreached,
        ok: den.length >= MIN_DEN_TILES && unreached.length === MAX_UNREACHED,
      };
    });
    await captureBoard(h, witness(measured).board);

    for (const one of measured) {
      const seed = `the maze laid out from seed ${one.board.seed}`;
      assertGreaterThanOrEqual(
        one.den.length,
        MIN_DEN_TILES,
        `den-interior ('d') tiles in ${seed}, the chamber a released predator ` +
          `comes out of`,
      );
      const named = one.unreached
        .slice(0, NAMED)
        .map((tile) => `(${tile.tx}, ${tile.ty})`)
        .join(", ");
      assertEqual(
        one.unreached.length,
        MAX_UNREACHED,
        `den-interior tiles the forager's start tile (${one.start.tx}, ` +
          `${one.start.ty}) cannot be reached from over corridor, den and gate ` +
          `tiles, of the ${one.den.length} in ${seed}` +
          (named === "" ? "" : `, at ${named}`),
      );
    }
  },
);
