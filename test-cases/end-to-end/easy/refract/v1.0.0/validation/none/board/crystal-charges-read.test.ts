// board/crystal-charges-read — a crystal's charge count reads from its form.
//
// specs/board.md: a crystal carries 1 to MAX_CHARGES (3) charges and a running
// spent count, and its form shows both. How it shows the charge count is the
// build's — pips, numerals, a dimming form — so what is decided is that the
// RENDER MOVES WITH THE NUMBER, and nothing about what it moves to.
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
// THE POSE. One channel across a 5x1 row: the two triangle emitters the board
// has to declare (specs/board.md "Channels": a board declares 1 to 3 channels)
// at the ends, the crystal one cell in. The emitters sit a full CELL_PITCH (96)
// from the sampled center, so their forms stay clear of the sampled disk.
//
// THE STILL is a third pose carrying both counts at once, because a reviewer
// judging whether a charge count reads without counting slowly wants the two
// forms side by side; the decision above is taken on the two same-cell frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";
import { maxPairedDistance, sampleDisk } from "./sampling";

/** The two poses the reading is taken on: one cell, two charge counts. */
const ONE_CHARGE = "T1..T";
const THREE_CHARGES = "T3..T";

/** The cell the crystal stands in on both of them. */
const CRYSTAL_CELL = { col: 1, row: 0 };

/** The reviewer's frame: both counts on one board, side by side. */
const BOTH_COUNTS = "T1.3T";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("renders a 1-charge and a 3-charge crystal differently", async () => {
  await loadBoard(h, BOTH_COUNTS);
  await captureStill(h, "charges");

  const first = await loadBoard(h, ONE_CHARGE);
  const at = center(first, CRYSTAL_CELL);
  const one = await sampleDisk(h, at.x, at.y);

  await loadBoard(h, THREE_CHARGES);
  const three = await sampleDisk(h, at.x, at.y);

  assertGreaterThan(
    maxPairedDistance(one, three),
    0,
    "the same cell posed at 1 charge and at 3 charges, point against point",
  );
});
