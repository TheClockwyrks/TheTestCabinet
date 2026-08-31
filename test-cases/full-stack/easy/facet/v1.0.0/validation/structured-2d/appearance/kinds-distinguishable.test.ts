// Facet — appearance/kinds-distinguishable: no two of the seven kinds are drawn
// the same.
//
// WHAT IS BEING DECIDED. specs/board.md hands the palette, the gem artwork and
// the form to the build and then states what the look must deliver: "The seven
// kinds are told apart at a glance, at every strain and under every cut."
// specs/overview.md holds the same seven to the same bar — "Each of the seven
// kinds carries one distinct hue, and each also carries a form, marking, or facet
// pattern of its own, so the seven are told apart by more than hue". So no color,
// no shape and no style is read here. The one question with a yes/no answer is
// whether any two of the seven are drawn the SAME, and that is all this decides.
//
// HOW ONE CELL DECIDES IT. Every reading is taken at ONE cell of one posed board,
// with one kind after another written into that cell through `setGem`, which
// specs/instrumentation.md defines as touching that cell alone. Everything but
// the gem is therefore held fixed — the same neighbors, the same board frame, the
// same background, the same box of device pixels — so the distance between two
// readings is the distance between two gems and nothing else. A sweep that posed
// each kind at a cell of its own would instead be measuring whatever else differs
// between those cells.
//
// THE CONTROL THAT MAKES THE READING MEAN SOMETHING. A build is entitled to an
// idle animation, so two readings of one cell taken frames apart need not be
// identical. The sweep therefore ends by writing the FIRST kind back into that
// same cell and reading it once more, a whole sweep after the reading it is
// measured against — a span at least as long as any pair below. That distance is
// what the instrument reads when the gem did not change, and it must stay within
// PATCH_SAME_MAX. A build whose cell reads further than that from itself has told
// this check nothing, and it fails here rather than passing pairs on movement.
//
// THE CURSOR IS PARKED OFF THE PROBE CELL. specs/ui.md marks the cell at
// `state.cursor`, and a mark standing on the probe cell would sit over every
// reading alike, hiding gem from gem. It is moved to the far corner so what the
// box holds is the gem.

import { afterEach, beforeEach, it } from "vitest";
import { quietRowsWithEscape, tokenOf, withCells } from "../board";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { GEM_KINDS, PATCH_DISTINCT_MIN, PATCH_SAME_MAX } from "../constants";
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

/** Where the cursor is sent, so its mark never sits on the probe cell. */
const PARKED_COL = 0;
const PARKED_ROW = 0;

/** The board every reading is taken over: the run-free filler, with its escape. */
const BOARD = quietRowsWithEscape([]);

/**
 * Real milliseconds the produced art is given before the first reading.
 *
 * specs/assets.md has a build ship its gems as produced files, and a file is
 * decoded off the frame loop rather than inside it, so a sweep begun before they
 * arrive could compare a placeholder against a finished sprite. This spends REAL
 * time only: the simulation stands still through it.
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

it("draws each of the seven kinds apart from the other six in one cell", async () => {
  loadBoard(h, BOARD);
  h.debug.setCursor(PARKED_COL, PARKED_ROW);
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

  // The control: the first kind written back into the same cell, a full sweep
  // later than the reading it answers for.
  h.debug.setGem(PROBE_COL, PROBE_ROW, tokenOf(GEM_KINDS[0], 0));
  await h.advance(1);
  const again = readPatch(h, PROBE_COL, PROBE_ROW);

  // Evidence, and no part of the verdict: the seven in one row of one board.
  loadBoard(h, KINDS_ROW);
  await h.advance(1);
  captureStill(h, "kinds");

  assertLessThanOrEqual(
    patchDistance(patches[0], again),
    PATCH_SAME_MAX,
    `how far cell (${PROBE_COL},${PROBE_ROW}) reads from itself with a ` +
      `${GEM_KINDS[0]} written into it twice`,
  );

  for (let a = 0; a < GEM_KINDS.length; a += 1) {
    for (let b = a + 1; b < GEM_KINDS.length; b += 1) {
      assertGreaterThan(
        patchDistance(patches[a], patches[b]),
        PATCH_DISTINCT_MIN,
        `how far a ${GEM_KINDS[a]} and a ${GEM_KINDS[b]} read apart at cell ` +
          `(${PROBE_COL},${PROBE_ROW})`,
      );
    }
  }
});
