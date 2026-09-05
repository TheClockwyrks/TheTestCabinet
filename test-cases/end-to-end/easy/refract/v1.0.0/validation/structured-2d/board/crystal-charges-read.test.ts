// Refract — board/crystal-charges-read: a crystal's charge count reads from
// its form.
//
// specs/board.md "Nodes": a crystal carries 1 to MAX_CHARGES (3) charges and a
// running spent count, and its form shows both, so a player tracks a crystal
// without counting segments. This point decides the charge half: a 1-charge and
// a 3-charge crystal render differently. What either of them looks like is the
// build's and is decided nowhere here.
//
// THE SAME CELL, POSED TWICE. The two readings are taken at one cell center on
// two boards that differ in that cell alone: "T1..T" and "T3..T". Comparing two
// DIFFERENT cells of one board instead would let any gradient, vignette or
// dithered texture between the two positions answer for the crystal, so a build
// drawing identical art for 1 and 3 charges would still read as differing — the
// exact failure this point exists to catch. Posed in turn at the same cell, the
// neighbouring cells and the background behind the region are identical between
// the two readings and the only thing that moved is the charge count.
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
  resetTo,
  type Harness,
} from "../harness";
import { cellCenter, NODE_R } from "../notation";
import { maxRegionDifference, readRegion } from "./pixels";

/** The two poses the reading is taken on: one cell, two charge counts. */
const ONE_CHARGE = "T1..T";
const THREE_CHARGES = "T3..T";

/** The reviewer's frame: both counts on one board, side by side. */
const BOTH_COUNTS = "T1.3T";

/** The cell the crystal stands in on both poses. */
const CRYSTAL_COL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it("renders 1 and 3 charges differently", async () => {
  await loadBoard(h, BOTH_COUNTS);
  // A 1-charge and a 3-charge crystal side by side.
  captureStill(h, "charges");

  const first = await loadBoard(h, ONE_CHARGE);
  const at = cellCenter(CRYSTAL_COL, 0, first.cols, first.rows);
  const one = readRegion(h, at.x, at.y, NODE_R);

  await loadBoard(h, THREE_CHARGES);
  const three = readRegion(h, at.x, at.y, NODE_R);

  assertGreaterThan(
    maxRegionDifference(one, three),
    0,
    "the same cell posed at 1 charge and at 3 charges, over its NODE_R region",
  );
});
