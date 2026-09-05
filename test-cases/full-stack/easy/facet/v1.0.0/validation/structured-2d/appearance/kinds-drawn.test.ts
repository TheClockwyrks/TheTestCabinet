// Facet — appearance/kinds-drawn: a gem of each of the seven kinds is drawn at
// the cell it stands in.
//
// WHAT IS BEING DECIDED. specs/board.md hands the palette, the gem artwork and
// the form to the build — "Presentation is yours" — and specs/ui.md lists the
// board among what the `playing` screen shows. So no color, no form and no style
// is read here, and nothing here says whether two kinds are easy to tell apart:
// that is the reviewer's judgement. The one question with a yes/no answer is
// whether the build draws SOMETHING at a cell for each of the seven kinds, and a
// build that renders a kind as nothing at all leaves a hole in the board where a
// gem stands.
//
// HOW THE READING IS TAKEN. Every reading is taken at ONE cell of one posed
// board, with one kind after another written into that cell through `setGem`,
// which specs/instrumentation.md defines as touching that cell alone. What each
// is measured against is the SAME box of device pixels with no board in play at
// all: specs/instrumentation.md's `clearBoard` "Leaves no board in play, so
// `cols` and `rows` are `0` and no cell is reported", so what the box then holds
// is whatever the build draws behind its board. A cell that reads identically
// with a gem written into it and with the board gone is a cell the build drew no
// gem into.
//
// THE BOARDLESS READING IS TAKEN AFTER THE SWEEP AND BEFORE THE EVIDENCE, so
// the frame it reads is the frame `clearBoard` produced rather than a later pose
// standing on the canvas.
//
// NOTHING IS SELECTED THROUGH ANY OF IT. specs/ui.md marks the cell at
// `state.selection`, and a mark standing on the probe cell would sit in the seven
// readings and not in the one without a board. `loadBoard` leaves nothing
// selected and the selection is cleared again here, so what the box holds is the
// gem.

import { afterEach, beforeEach, it } from "vitest";
import { quietRowsWithEscape, tokenOf, withCells } from "../board";
import { assertGreaterThan } from "../assert";
import { GEM_KINDS } from "../constants";
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
 * The cell every reading is taken at.
 *
 * Mid-board, so the box `readPatch` cuts is a whole cell's worth of pixels rather
 * than one clamped at a canvas edge, and clear of the escape swap's corner. The
 * quiet filler holds another kind at each of its four orthogonal neighbors and at
 * both cells beyond them on each axis, so whatever is written here joins no run
 * under R4 and the board simply stands.
 */
const PROBE_COL = 3;
const PROBE_ROW = 3;

/** The board every reading is taken over: the run-free filler, with its escape. */
const BOARD = quietRowsWithEscape([]);

/**
 * Real milliseconds the produced art is given before the first reading.
 *
 * specs/assets.md has a build ship its gems as produced files, and a file is
 * decoded off the frame loop rather than inside it, so a sweep begun before they
 * arrive could read a placeholder. This spends REAL time only: the simulation
 * stands still through it.
 */
const ART_SETTLE_MS = 250;

/** The seven side by side in one row, posed for the `kinds` output alone. */
const KINDS_ROW = withCells(
  BOARD,
  GEM_KINDS.map((kind, col) => ({
    col,
    row: PROBE_ROW,
    token: tokenOf(kind, 0),
  })),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a gem at the cell for each of the seven kinds", async () => {
  loadBoard(h, BOARD);
  h.debug.clearSelection();
  await h.settle(ART_SETTLE_MS);
  await h.advance(1);

  // One kind after another into the same cell, a frame each so the build draws
  // what it was handed, and the pixels that frame left in the cell.
  const patches: Patch[] = [];
  for (const kind of GEM_KINDS) {
    h.debug.setGem(PROBE_COL, PROBE_ROW, tokenOf(kind, 0));
    await h.advance(1);
    patches.push(readPatch(h, PROBE_COL, PROBE_ROW));
  }

  // The same box with no board in play: what the build draws behind its board.
  h.debug.clearBoard();
  await h.advance(1);
  const boardless = readPatch(h, PROBE_COL, PROBE_ROW);

  // Evidence, and no part of the verdict: the seven in one row of one board.
  loadBoard(h, KINDS_ROW);
  await h.advance(1);
  captureStill(h, "kinds");

  for (const [at, kind] of GEM_KINDS.entries()) {
    assertGreaterThan(
      patchDistance(patches[at], boardless),
      0,
      `how far cell (${PROBE_COL},${PROBE_ROW}) holding a ${kind} reads from ` +
        `the same box with no board in play`,
    );
  }
});
