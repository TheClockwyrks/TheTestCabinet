// Facet — instrumentation/cell-geometry: every cell the snapshot reports carries
// the center the board formulas give for its column and row.
//
// WHY THIS IS A POINT. `x` and `y` are two of the four snapshot fields
// specs/instrumentation.md marks derived rather than stored — "a cell's `x`,
// `y` | the cell center formulas in `specs/board.md`" — and specs/board.md
// fixes those formulas outright:
//
//   cellX(col) = BOARD_CX - (GRID_COLS - 1) * CELL_PITCH / 2 + col * CELL_PITCH
//   cellY(row) = BOARD_CY - (GRID_ROWS - 1) * CELL_PITCH / 2 + row * CELL_PITCH
//
// with `CELL_PITCH` 72 and `(BOARD_CX, BOARD_CY)` (640, 396), and then states
// the range they produce: "Cell centers therefore run `x` `388..892` and `y`
// `144..648`." The whole pointer half of the game rests on this: a press
// resolves against the cell whose center is within `GEM_HIT_R` (36) of it, so a
// board drawn half a pitch off, or centered on the stage rather than on
// `BOARD_CY`, makes every press land on the wrong cell — or on nothing.
//
// WHY BOTH THE FORMULAS AND THE RANGE ARE CHECKED. They are two statements, and
// a build can satisfy one without the other: a grid at the right pitch but the
// wrong origin passes every neighbor-to-neighbor spacing and puts the whole
// board somewhere else. So each reported center is held to the formula for its
// own cell, and the extremes are held to the four numbers the specification
// prints.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE. Where the gem is DRAWN. That is the
// appearance points' business; this reads the geometry the snapshot reports,
// which is what every scenario in this project aims a pointer by.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength } from "../assert";
import { cellX, cellY, quietBoard } from "../board";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * The four numbers specs/board.md prints for the range the formulas produce.
 *
 * Stated as literals rather than computed from the formulas, because they are a
 * second statement of the specification rather than a consequence of the first
 * one: a build that got the origin wrong satisfies the pitch everywhere and
 * lands the board outside these.
 */
const X_RANGE = { first: 388, last: 892 };
const Y_RANGE = { first: 144, last: 648 };

/** Half a thousandth: the centers are whole numbers, and are read as such. */
const PLACES = 3;

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts every reported cell center where the board formulas put it", async () => {
  requireSurface();
  // Any full board answers this — the geometry is the grid's rather than the
  // gems' — so the run-free filler is posed and left to rest.
  await loadBoard(h, quietBoard());
  await h.advance(1);
  await captureStill(h, "board");

  const cells = (await h.snapshot()).board.cells;
  assertLength(cells, GRID_COLS * GRID_ROWS, "the reported cells");

  for (const cell of cells) {
    const at = `(${cell.col},${cell.row})`;
    assertCloseTo(cell.x, cellX(cell.col), PLACES, `the x of ${at}`);
    assertCloseTo(cell.y, cellY(cell.row), PLACES, `the y of ${at}`);
  }

  // And the board sits where the specification says the whole grid sits, which
  // is the statement the per-cell formulas alone cannot make.
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  assertCloseTo(
    Math.min(...xs),
    X_RANGE.first,
    PLACES,
    "the x of the leftmost column of centers",
  );
  assertCloseTo(
    Math.max(...xs),
    X_RANGE.last,
    PLACES,
    "the x of the rightmost column of centers",
  );
  assertCloseTo(
    Math.min(...ys),
    Y_RANGE.first,
    PLACES,
    "the y of the topmost row of centers",
  );
  assertCloseTo(
    Math.max(...ys),
    Y_RANGE.last,
    PLACES,
    "the y of the bottommost row of centers",
  );
});
