// Facet — appearance/selection-marked: the selected cell is drawn differently
// from that same cell unselected, and differently again from that cell carrying
// the cursor alone.
//
// WHAT IS BEING DECIDED. specs/ui.md lists the selection among what the `playing`
// screen shows — "The selection — The cell at `state.selection` when there is
// one, marked distinctly from the cursor" — and specs/overview.md requires that
// "The cursor's cell and the selected cell each read distinctly". Two things are
// asked of the mark, and both are read here: that a selected cell does not look
// unselected, and that it does not look like a cell the cursor merely stands on.
// The second is what "distinctly from the cursor" adds, and it is the one a
// player depends on — specs/controls.md has the cursor move freely while a
// selection stands, so both marks are on the board at once and a build that drew
// them the same would leave a player unable to say which cell the next `confirm`
// would swap with.
//
// What the marks look like is the build's, and nothing here reads a color, a
// shape or a style. Nor does anything here decide whether the CURSOR's own mark
// is visible: that is `appearance/cursor-marked`, and the pair it answers for is
// not asserted below.
//
// HOW ONE CELL DECIDES IT. Four readings are taken at ONE cell of one posed
// board, and the board is never touched between them: the cell plain, the cell
// carrying the cursor alone, the cell selected with the cursor parked far away,
// and the cell plain again. The gem in that cell, its neighbors, the board frame
// and the background are the same in all four, so the distance between two
// readings is the marks and nothing else. The first and the last are the SAME
// posed state and are the control — they must read within PATCH_SAME_MAX of each
// other, or the cell moves on its own and every reading between them says nothing
// — and they bracket the whole sweep, so the control spans a longer stretch of
// the build's own animation than either pair it answers for.
//
// WHY THE CELL IS READ THROUGH TWO BOXES. specs/board.md confines a GEM's drawn
// form to `GEM_R` (30) of the cell center, and says nothing of the kind about a
// selection mark, which specs/ui.md puts on the CELL rather than on the gem. A
// build is free to mark it by tinting the gem, by drawing a ring at the cell's
// edge, or by filling the cell behind it — so each reading is taken through the
// gem's own box, which `readPatch` centers inside `GEM_R`, and again through a
// box holding the whole cell, and the cell reads apart when EITHER box does. Both
// boxes hold this cell's pixels alone: the larger stops inside half of
// `CELL_PITCH`, and no neighbor's drawn form comes nearer than `CELL_PITCH` minus
// `GEM_R`.
//
// WHY THE SELECTED READING PUTS THE CURSOR ELSEWHERE. specs/controls.md leaves
// the cursor wherever it was when a selection is made and moves it independently
// afterward, so a selected cell the cursor is not on is an ordinary position of
// play. Reading it that way is also what isolates the selection's mark: with the
// cursor parked at the same far cell in the plain reading and in the selected
// one, the only thing that changed at the probe cell is the selection.

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
 * Where the cursor stands for the readings it is meant to be absent from.
 *
 * The opposite corner of the board, three cells away on each axis, so no mark
 * drawn on that cell can reach into the probe cell's own square.
 */
const PARKED_COL = 0;
const PARKED_ROW = 0;

/** Where the cursor stands for the `selection` output, beside the selected cell. */
const NEIGHBOR_COL = 4;
const NEIGHBOR_ROW = 3;

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

it("draws the selected cell apart from that cell unselected and from that cell under the cursor", async () => {
  await loadBoard(h, BOARD);
  await h.settle(ART_SETTLE_MS);

  // The cell plain: neither selected nor under the cursor.
  await h.debug.clearSelection();
  await h.debug.setCursor(PARKED_COL, PARKED_ROW);
  await h.advance(1);
  const plain = {
    gem: await readPatch(h, PROBE_COL, PROBE_ROW),
    cell: await readPatch(h, PROBE_COL, PROBE_ROW, CELL_HALF),
  };

  // The cell carrying the cursor and nothing else.
  await h.debug.setCursor(PROBE_COL, PROBE_ROW);
  await h.advance(1);
  const underCursor = {
    gem: await readPatch(h, PROBE_COL, PROBE_ROW),
    cell: await readPatch(h, PROBE_COL, PROBE_ROW, CELL_HALF),
  };

  // The cell selected, with the cursor back where it stood for the plain reading.
  await h.debug.setSelection(PROBE_COL, PROBE_ROW);
  await h.debug.setCursor(PARKED_COL, PARKED_ROW);
  await h.advance(1);
  const selected = {
    gem: await readPatch(h, PROBE_COL, PROBE_ROW),
    cell: await readPatch(h, PROBE_COL, PROBE_ROW, CELL_HALF),
  };

  // And plain again — the same posed state as the first reading, three frames on.
  await h.debug.clearSelection();
  await h.debug.setCursor(PARKED_COL, PARKED_ROW);
  await h.advance(1);
  const plainAgain = {
    gem: await readPatch(h, PROBE_COL, PROBE_ROW),
    cell: await readPatch(h, PROBE_COL, PROBE_ROW, CELL_HALF),
  };

  // Evidence, and no part of the verdict: the selected cell and the cursor's cell
  // standing side by side, as they do whenever a player has picked a gem.
  await h.debug.setSelection(PROBE_COL, PROBE_ROW);
  await h.debug.setCursor(NEIGHBOR_COL, NEIGHBOR_ROW);
  await h.advance(1);
  await captureStill(h, "selection");

  assertLessThanOrEqual(
    apart(plain, plainAgain),
    PATCH_SAME_MAX,
    `how far cell (${PROBE_COL},${PROBE_ROW}) reads from itself across the ` +
      `sweep with nothing selected and the cursor parked both times`,
  );

  assertGreaterThan(
    apart(selected, plain),
    PATCH_DISTINCT_MIN,
    `how far cell (${PROBE_COL},${PROBE_ROW}) reads selected from the same ` +
      `cell unselected`,
  );

  assertGreaterThan(
    apart(selected, underCursor),
    PATCH_DISTINCT_MIN,
    `how far cell (${PROBE_COL},${PROBE_ROW}) reads selected from the same ` +
      `cell carrying the cursor alone`,
  );
});
