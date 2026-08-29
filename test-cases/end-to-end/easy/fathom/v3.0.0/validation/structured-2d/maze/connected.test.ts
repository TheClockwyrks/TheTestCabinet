// maze/connected — one connected region.
//
// specs/maze.md, under "A conforming maze": "One connected region. Every
// corridor tile is reachable from every other corridor tile, moving only between
// corridor neighbors. The forager's start tile, both mouths of the wrap tunnel,
// and every tile that holds a plankton lie in that one region."
//
// The reading floods from THE FORAGER'S START TILE, over corridor neighbors
// alone, and asks whether it reached every corridor tile on the board. That one
// sweep decides the whole rule as the item states it: a plankton sits on every
// corridor tile outside the den (specs/gameplay.md), and both wrap mouths are
// corridor tiles, so "every corridor tile is in the region the forager starts
// in" carries the start tile, the mouths and every plankton with it.
//
// THE WRAP TUNNEL COUNTS AS AN ADJACENCY. specs/maze.md makes the two mouths
// "neighbors of each other", so the flood steps between them the way it steps
// between any two neighbors. A board whose left and right halves join only
// through the tunnel is one region, and the point says so.
//
// THE BOARD IS THE BUILD'S OWN, over several freshly seeded layouts, because
// finding the property in a board a build invented IS the check.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { corridorTiles, floodReachable, tileAt } from "../maze";
import { captureBoard, freshBoards, requireLaidOut, witness } from "./boards";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays out one connected region, reaching every corridor tile from the forager's start", async () => {
  const boards = freshBoards(h);
  requireLaidOut(boards);

  const measured = boards.map((board) => {
    const start = board.snapshot.forager;
    const total = corridorTiles(board.snapshot).length;
    const reached = floodReachable(board.snapshot, start.tx, start.ty).size;
    return { board, start, total, reached, ok: reached === total };
  });
  await captureBoard(h, witness(measured).board);

  for (const one of measured) {
    assertEqual(
      one.reached,
      one.total,
      `corridor tiles reachable over corridor neighbors from the forager's ` +
        `start tile (${one.start.tx}, ${one.start.ty}), which the layout marks ` +
        `'${tileAt(one.board.snapshot, one.start.tx, one.start.ty) ?? "off the board"}', ` +
        `of the ${one.total} the maze laid out from seed ${one.board.seed} carries`,
    );
  }
});
