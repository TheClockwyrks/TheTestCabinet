// Facet — appearance/selection-marked: the cell the player has hold of is drawn
// differently from that same cell with nothing selected.
//
// WHAT IS BEING DECIDED. specs/ui.md lists the selection among what the `playing`
// screen shows — "The selection — The cell at `state.selection` when there is
// one, marked" — and specs/overview.md requires that "The selected cell reads
// distinctly against a board of gems". The selection is the whole of what a
// player has hold of: specs/controls.md makes a move a press that takes a gem, a
// carry onto its neighbor and a release, so a player who cannot see which gem is
// held cannot see what a release would play. What the mark looks like is the
// build's, and nothing here reads a color, a shape or a style. The one question
// with a yes/no answer is whether the cell is drawn differently when the gem in
// it is the one being held, and that is what this decides.
//
// HOW ONE CELL DECIDES IT. Two readings are taken at ONE cell of one posed board,
// and the board is never touched between them: the cell with nothing selected,
// and the same cell selected. The gem in that cell, its neighbors, the board
// frame and the background are the same in both, so the distance between them is
// the mark and nothing else.
//
// WHY TWO FRAMES ARE ENOUGH, WITH NO CONTROL BESIDE THEM. The gem posed at the
// probe cell is `plain` at strain 0. specs/board.md gives its continuous effect
// to the three cuts alone and puts a gem's damage on the stone rather than in an
// effect, so a plain stone at strain 0 is entitled to stand still and there is
// nothing in the cell for the two frames to differ by except the mark. A build
// that animated the whole field under its board could answer this spuriously,
// which is a false pass and never a false failure.
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
// NO OFFER STANDS THROUGH EITHER READING. specs/ui.md draws the two cells of a
// standing offer exchanged, which would put a different gem in the box, and that
// is `appearance/offer-drawn-exchanged`'s point rather than this one's.

import { afterEach, beforeEach, it } from "vitest";
import { quietRowsWithEscape } from "../board";
import { assertGreaterThan } from "../assert";
import { CELL_PITCH } from "../constants";
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

/** Both boxes of the probe cell, off the frame the canvas is holding. */
async function readCell(): Promise<CellReading> {
  return {
    gem: await readPatch(h, PROBE_COL, PROBE_ROW),
    cell: await readPatch(h, PROBE_COL, PROBE_ROW, CELL_HALF),
  };
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the selected cell apart from that same cell unselected", async () => {
  await loadBoard(h, BOARD);

  // The cell with nothing selected and nothing offered.
  await h.debug.clearSelection();
  await h.debug.clearOffer();
  await h.advance(1);
  const unselected = await readCell();

  // The same cell, with the gem in it the one the player has hold of.
  await h.debug.setSelection(PROBE_COL, PROBE_ROW);
  await h.advance(1);
  const selected = await readCell();

  // Evidence, and no part of the verdict: the held gem standing on its board.
  await captureStill(h, "selection");

  assertGreaterThan(
    apart(selected, unselected),
    0,
    `how far cell (${PROBE_COL},${PROBE_ROW}) reads selected from the same ` +
      `cell unselected`,
  );
});
