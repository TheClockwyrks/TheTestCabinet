// Refract — board/crystal-charges-read: a crystal's charge count reads from
// its form.
//
// specs/board.md: a crystal carries `charges` (1 to MAX_CHARGES) and a running
// `spent` count, and its form shows both — a player tracks a crystal without
// counting segments. What that looks like is the build's; what a script decides
// is that the RENDER MOVES WITH THE NUMBER, and nothing about what it moves to.
//
// THE SAME CELL, POSED TWICE. The 1-charge and the 3-charge readings are taken
// at one cell center on two boards that differ in that cell alone: "T1..T" and
// "T3..T". Comparing two DIFFERENT cells of one board instead would let any
// gradient, vignette or dithered texture between the two positions answer for
// the crystal, so a build drawing identical art for 1 and 3 charges would still
// read as differing — the exact failure this point exists to catch. Posed in
// turn at the same cell, the neighbouring cells and the background behind the
// region are identical between the two readings and the only thing that moved
// is the charge count.
//
// THE STILL is a third pose carrying both counts at once, because a reviewer
// judging whether a charge count reads without counting slowly wants the two
// forms side by side; the decision above is taken on the two same-cell frames.

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

/** The two poses the reading is taken on: one cell, two charge counts. */
const ONE_CHARGE = "T1..T";
const THREE_CHARGES = "T3..T";

/** The reviewer's frame: both counts on one board, side by side. */
const BOTH_COUNTS = "T1.3T";

/** Every pose is one channel across a 5x1 row, the crystal one cell in. */
const COLS = 5;
const ROWS = 1;
const CRYSTAL_COL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

/** Every rendered pixel within NODE_R of the posed crystal's cell center. */
function crystalRegion(): ReturnType<typeof diskPixels> {
  const center = nodeCenter(CRYSTAL_COL, 0, COLS, ROWS);
  return diskPixels(h, center.x, center.y, NODE_R);
}

it("renders a 1-charge and a 3-charge crystal differently", async () => {
  await loadBoard(h, BOTH_COUNTS);
  captureStill(h, "charges");

  await loadBoard(h, ONE_CHARGE);
  const one = crystalRegion();

  await loadBoard(h, THREE_CHARGES);
  const three = crystalRegion();

  assertGreaterThan(
    maxRegionDifference(one, three),
    0,
    "the same cell posed at 1 charge and at 3 charges, over its NODE_R (30) " +
      "region (specs/board.md: a crystal's form shows its charge count)",
  );
});
