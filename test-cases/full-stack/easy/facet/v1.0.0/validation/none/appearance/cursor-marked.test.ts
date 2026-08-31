// Facet — appearance/cursor-marked: the cell the cursor stands on is drawn
// differently from that same cell with the cursor somewhere else.
//
// WHAT IS BEING DECIDED. specs/ui.md lists the cursor among what the `playing`
// screen shows — "The cursor — The cell at `state.cursor`, marked" — and
// specs/overview.md requires that "The cursor's cell and the selected cell each
// read distinctly, and both read against a board of gems". The cursor is the
// whole of the keyboard's address on the board: specs/controls.md moves it with
// `up`, `down`, `left` and `right` and has `confirm` act on the cell it stands
// on, so a player who cannot see where it is cannot use the keyboard at all. What
// the mark looks like is the build's, and nothing here reads a color, a shape or
// a style. The one question with a yes/no answer is whether the cell is drawn
// differently when the cursor is on it, and that is what this decides.
//
// HOW ONE CELL DECIDES IT. Three readings are taken at ONE cell of one posed
// board, and the board is never touched between them: the cursor is parked far
// away, then moved onto the probe cell, then parked again. The gem in that cell,
// its neighbors, the board frame and the background are the same in all three, so
// the distance between two readings is the mark and nothing else. The first and
// the third are the SAME posed state and are the control — they must read within
// PATCH_SAME_MAX of each other, or the cell moves on its own and the reading in
// the middle says nothing — and they bracket the middle reading, so the control
// spans a longer stretch of the build's own animation than the pair it answers
// for.
//
// WHY THE CELL IS READ THROUGH TWO BOXES. specs/board.md confines a GEM's drawn
// form to `GEM_R` (30) of the cell center, and says nothing of the kind about a
// cursor mark, which specs/ui.md puts on the CELL rather than on the gem. A build
// is free to mark it by tinting the gem, by drawing a ring at the cell's edge, or
// by filling the cell behind it — so each reading is taken through the gem's own
// box, which `readPatch` centers inside `GEM_R`, and again through a box holding
// the whole cell, and the cell reads apart when EITHER box does. Both boxes hold
// this cell's pixels alone: the larger stops inside half of `CELL_PITCH`, and no
// neighbor's drawn form comes nearer than `CELL_PITCH` minus `GEM_R`.
//
// NOTHING IS SELECTED THROUGH ANY OF IT. specs/ui.md marks the selected cell too,
// and a selection standing on the probe cell would answer this question with the
// wrong mark.

import { afterEach, beforeEach, it } from "vitest";
import { quietRowsWithEscape } from "../board";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { CELL_PITCH, PATCH_DISTINCT_MIN, PATCH_SAME_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  patchDistance,
  readPatch,
  type Harness,
  type Patch,
} from "../harness";

/**
 * The cell every reading is taken at: mid-board, so both boxes are cut whole
 * rather than clamped at a canvas edge, and clear of the escape swap's corner.
 */
const PROBE_COL = 3;
const PROBE_ROW = 3;

/**
 * Where the cursor stands for the two readings it is meant to be absent from.
 *
 * The opposite corner of the board, three cells away on each axis, so no mark
 * drawn on that cell can reach into the probe cell's own square.
 */
const PARKED_COL = 0;
const PARKED_ROW = 0;

/**
 * Half the side of the second box a reading is taken through: the whole cell.
 *
 * One unit inside half of `CELL_PITCH` (36), which is where the cell's own square
 * ends, so the box holds every pixel this cell owns and none that a neighbor
 * owns. It cannot reach a neighbor's gem either, whose form specs/board.md
 * confines to `GEM_R` (30) of a center `CELL_PITCH` away and so no nearer than 42.
 */
const CELL_HALF = CELL_PITCH / 2 - 1;

/** The board every reading is taken over: the run-free filler, with its escape. */
const BOARD = quietRowsWithEscape([]);

/**
 * Real milliseconds the produced art is given before the first reading.
 *
 * specs/assets.md has a build ship its gems as produced files, and a file is
 * decoded off the frame loop rather than inside it, so a reading taken before
 * they arrive could hold a placeholder. This spends REAL time only: the
 * simulation stands still through it.
 */
const ART_SETTLE_MS = 250;

/** One cell read through both boxes at once: the gem's own, and the whole cell's. */
interface CellReading {
  gem: Patch;
  cell: Patch;
}

/**
 * How far two readings of one cell stand apart: the larger of the two boxes'
 * distances.
 *
 * The larger rather than the mean of them, because a mark drawn only on the gem
 * and a mark drawn only around it are both marks, and each registers in one box
 * while the other dilutes it.
 */
function apart(a: CellReading, b: CellReading): number {
  return Math.max(patchDistance(a.gem, b.gem), patchDistance(a.cell, b.cell));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the cursor's cell differently from that cell with the cursor elsewhere", async () => {
  await loadBoard(h, BOARD);
  await h.debug.clearSelection();
  await h.settle(ART_SETTLE_MS);

  // The cursor away from the probe cell.
  await h.debug.setCursor(PARKED_COL, PARKED_ROW);
  await h.advance(1);
  const away = {
    gem: await readPatch(h, PROBE_COL, PROBE_ROW),
    cell: await readPatch(h, PROBE_COL, PROBE_ROW, CELL_HALF),
  };

  // The cursor on it, with nothing else about the board changed.
  await h.debug.setCursor(PROBE_COL, PROBE_ROW);
  await h.advance(1);
  const on = {
    gem: await readPatch(h, PROBE_COL, PROBE_ROW),
    cell: await readPatch(h, PROBE_COL, PROBE_ROW, CELL_HALF),
  };

  // Evidence, and no part of the verdict: the cursor standing on its cell.
  await captureStill(h, "cursor");

  // And away again — the same posed state as the first reading, two frames later.
  await h.debug.setCursor(PARKED_COL, PARKED_ROW);
  await h.advance(1);
  const awayAgain = {
    gem: await readPatch(h, PROBE_COL, PROBE_ROW),
    cell: await readPatch(h, PROBE_COL, PROBE_ROW, CELL_HALF),
  };

  assertLessThanOrEqual(
    apart(away, awayAgain),
    PATCH_SAME_MAX,
    `how far cell (${PROBE_COL},${PROBE_ROW}) reads from itself across the ` +
      `sweep with the cursor parked at (${PARKED_COL},${PARKED_ROW}) both times`,
  );

  assertGreaterThan(
    apart(away, on),
    PATCH_DISTINCT_MIN,
    `how far cell (${PROBE_COL},${PROBE_ROW}) reads with the cursor on it from ` +
      `the same cell with the cursor at (${PARKED_COL},${PARKED_ROW})`,
  );
});
