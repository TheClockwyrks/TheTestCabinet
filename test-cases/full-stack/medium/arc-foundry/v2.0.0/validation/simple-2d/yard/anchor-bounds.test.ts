// yard/anchor-bounds — a 2 by 2 footprint fits only at `col` `0`–`48` and `row`
// `0`–`31`, so an anchor outside that range places nothing.
//
// `specs/yard.md` states it as the first placement condition, and the reason is
// arithmetic: an anchor at `col` `49` would need column `50` for its right half,
// and the grid has `50` columns numbered `0`–`49`. A build that clamps the anchor
// instead of refusing it silently places the structure somewhere the player did
// not ask for; one that lets it through writes outside its own grid.
//
// TWO CONFORMANT ANSWERS, ONE OBSERVABLE. `specs/instrumentation.md` gives an
// operation two ways to reject: a placement that fails a condition is REFUSED,
// and an argument outside the domain the operation states FAILS LOUDLY. An anchor
// off the grid can be read either way, so this decides the half both readings
// share and the item names — nothing is placed and nothing else changes. A pose
// that throws leaves the engine's state exactly as it was, because a transition
// that never returned is a transition the engine never stored.

import { afterEach, beforeEach, it } from "vitest";

import { GRID_COLS, GRID_ROWS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  MAX_ANCHOR_COL,
  MAX_ANCHOR_ROW,
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/**
 * Anchors no 2 by 2 footprint fits at: one past the last legal column, one past
 * the last legal row, the last column and row of the grid itself, and negatives
 * in each axis.
 */
const OUT_OF_RANGE = [
  { col: MAX_ANCHOR_COL + 1, row: 10 },
  { col: 10, row: MAX_ANCHOR_ROW + 1 },
  { col: GRID_COLS - 1, row: GRID_ROWS - 1 },
  { col: -1, row: 10 },
  { col: 10, row: -1 },
  { col: -1, row: -1 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("places nothing at an anchor no footprint fits at", async () => {
  openYard(h);
  const before = h.snapshot();

  for (const anchor of OUT_OF_RANGE) {
    // Either answer is conformant; what is decided is that neither placed
    // anything.
    try {
      h.debug.placeBlocker(anchor.col, anchor.row);
    } catch {
      // A loud refusal, which is the other conformant answer.
    }
    const s = h.snapshot();
    assertEqual(
      s.structures.length,
      before.structures.length,
      `the yard to stay empty after a placement anchored at ` +
        `(${anchor.col}, ${anchor.row}), outside the col 0-${MAX_ANCHOR_COL} ` +
        `by row 0-${MAX_ANCHOR_ROW} range a 2 by 2 footprint fits in`,
    );
    assertEqual(
      s.stampsLeft,
      before.stampsLeft,
      `the stamp allowance after a placement anchored at ` +
        `(${anchor.col}, ${anchor.row})`,
    );
  }

  await h.advance(1);
  captureStill(h, "refused");
});
