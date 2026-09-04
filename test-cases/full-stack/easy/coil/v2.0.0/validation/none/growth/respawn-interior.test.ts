// growth/respawn-interior — every pellet the game places is an interior cell.
//
// specs/board.md's valid set opens with it: "It is an interior cell." And the
// interior is fixed exactly — "an interior of `28 x 16` cells, `col` in `[1, 28]`
// and `row` in `[1, 16]`" — so the reading is a pair of bounds rather than a
// tolerance. A pellet on a wall cell is a pellet a player cannot reach without
// dying, and a pellet off the grid entirely is one nobody can see.
//
// A LONG RUN, because the failure this catches is an off-by-one at an edge: a
// build drawing a column in `[0, 29]`, or a row in `[0, 17]`, places a reachable
// pellet almost every time and an unreachable one now and then. Thirty draws over
// a board of 448 cells is enough that an edge case comes up.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import {
  INTERIOR_COL_MAX,
  INTERIOR_COL_MIN,
  INTERIOR_ROW_MAX,
  INTERIOR_ROW_MIN,
} from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { driveEats } from "./eats";

/** Draws taken from the generator over the run. */
const EATS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places every pellet inside the interior specs/board.md fixes", async () => {
  const run = await captureReplay(h, "interior", () =>
    driveEats(h, { eats: EATS }),
  );

  for (const [index, placed] of run.placements.entries()) {
    assertBetween(
      placed.pellet.col,
      INTERIOR_COL_MIN,
      INTERIOR_COL_MAX,
      `the column of pellet ${index + 1} of ${EATS}`,
    );
    assertBetween(
      placed.pellet.row,
      INTERIOR_ROW_MIN,
      INTERIOR_ROW_MAX,
      `the row of pellet ${index + 1} of ${EATS}`,
    );
  }
});
