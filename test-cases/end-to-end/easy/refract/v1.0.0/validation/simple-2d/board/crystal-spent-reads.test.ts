// Refract — board/crystal-spent-reads: a crystal's spent count reads from its
// form.
//
// specs/board.md: a crystal carries `charges` (1 to MAX_CHARGES) and a running
// `spent` count, and "the two read apart at a glance" — a player tracks a
// crystal without counting segments. What that looks like is the build's; what
// a script can decide is that the spent readout is really THERE, as the review
// item states it: the crystal's region within NODE_R (30) changes once a traced
// beam enters it and its spent count goes from 0 to 1 — somewhere over the
// index-aligned samples the two regions differ by more than 50 of 441 RGB
// distance.
//
// The board is T1..3.T: the 1-charge crystal is adjacent to the triangle
// emitter, so the one-segment trace T(0,0) -> (1,0) enters it and spends its
// charge (specs/beams.md R5; a beam may end on a crystal mid-crossing, R8),
// which is the smallest arrangement that moves spent from 0 to 1.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  traceRoute,
  type Harness,
} from "../harness";
import { NODE_R } from "../notation";
import { diskPixels, maxRegionDifference } from "./masks";

/** The review item's distance: regions clearly apart over their samples. */
const DIFFER_MIN = 50;

/** A 1-charge crystal beside the triangle emitter, a 3-charge crystal apart. */
const READOUT_BOARD = "T1..3.T";

/** The board's dimensions. */
const COLS = 7;
const ROWS = 1;

/** Where the entered crystal sits. */
const ONE_CHARGE_COL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Every rendered pixel within NODE_R of the crystal at `col`. */
function crystalRegion(col: number): ReturnType<typeof diskPixels> {
  const center = nodeCenter(col, 0, COLS, ROWS);
  return diskPixels(h, center.x, center.y, NODE_R);
}

it("changes the crystal's region once a traced beam spends a charge", async () => {
  await resetTo(h, 1);
  await loadBoard(h, READOUT_BOARD);
  const before = crystalRegion(ONE_CHARGE_COL);

  // One segment from the adjacent emitter into the crystal spends its only
  // charge (specs/beams.md R5): spent goes from 0 to 1.
  traceRoute(h, [
    [0, 0],
    [ONE_CHARGE_COL, 0],
  ]);
  const crystal = h
    .snapshot()
    .board.nodes.find((node) => node.col === ONE_CHARGE_COL && node.row === 0);
  assertEqual(
    crystal?.spent,
    1,
    "the traced beam entering the crystal spends one charge " +
      "(specs/beams.md R5)",
  );

  await h.advance(1);
  captureStill(h, "spent");

  assertGreaterThan(
    maxRegionDifference(before, crystalRegion(ONE_CHARGE_COL)),
    DIFFER_MIN,
    "the crystal's region within NODE_R (30) once spent goes from 0 to 1 " +
      "(specs/board.md: a crystal shows how many charges are spent)",
  );
});
