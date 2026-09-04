// Refract — board/crystal-charges-read: a crystal's charge count reads from
// its form.
//
// specs/board.md: a crystal carries `charges` (1 to MAX_CHARGES) and a running
// `spent` count, and "the two read apart at a glance" — a player tracks a
// crystal without counting segments. What that looks like is the build's; what
// a script can decide is that the charge readout is really THERE, as the review
// item states it: a 1-charge and a 3-charge crystal render differently within
// NODE_R (30) of their centers — somewhere over their index-aligned samples the
// two regions differ by more than 50 of 441 RGB distance.
//
// The board poses both crystals at once, T1..3.T.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
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

/** Where the two crystals sit. */
const ONE_CHARGE_COL = 1;
const THREE_CHARGE_COL = 4;

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

it("renders a 1-charge and a 3-charge crystal differently", async () => {
  await resetTo(h, 1);
  await loadBoard(h, READOUT_BOARD);
  captureStill(h, "charges");

  assertGreaterThan(
    maxRegionDifference(
      crystalRegion(ONE_CHARGE_COL),
      crystalRegion(THREE_CHARGE_COL),
    ),
    DIFFER_MIN,
    "the 1-charge and 3-charge crystals' regions within NODE_R (30) " +
      "(specs/board.md: a crystal shows its charge count)",
  );
});
