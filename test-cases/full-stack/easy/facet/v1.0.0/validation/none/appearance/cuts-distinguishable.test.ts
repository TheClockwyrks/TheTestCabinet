// Facet — appearance/cuts-distinguishable: the cuts a gem can carry are drawn
// apart from one another.
//
// WHAT IS BEING DECIDED. specs/board.md gives every gem exactly one of the four
// cuts and requires that "The four cuts are told apart at a glance", adding that
// "a cut sits with its gem's kind rather than replacing it, so a player reads a
// gem's kind and its cut in the same glance". specs/overview.md states the same
// requirement — "A `brilliant`, a `star`, and a `prism` each read as distinct
// from a plain gem and from one another". Three of the four carry a kind, and
// those three are what this point reads: a `plain`, a `brilliant` and a `star` of
// ONE kind. The fourth, the `prism`, carries no kind at all, so it cannot be
// posed as a cut of the kind the other three carry and it is read by
// `appearance/prism-distinct`.
//
// No palette, no marking and no treatment is read here. The one question with a
// yes/no answer is whether any two of the three are drawn the SAME on one gem,
// and that is what this decides — a build that renders a `brilliant` exactly as
// it renders a `plain` leaves R8's creations invisible, and it fails here.
//
// HOW ONE CELL DECIDES IT. Every reading is taken at ONE cell of one posed board,
// with one cut after another written into that cell through `setGem`, which
// specs/instrumentation.md defines as touching that cell alone. The kind and the
// strain are held fixed across all three, and so is everything around the cell —
// the same neighbors, the same board frame, the same background, the same box of
// device pixels — so the distance between two readings is the distance between
// two cuts of one gem and nothing else.
//
// THE CONTROL THAT MAKES THE READING MEAN SOMETHING. A build is entitled to an
// idle animation, so two readings of one cell taken frames apart need not be
// identical. The sweep therefore ends by writing the first cut back into that
// same cell and reading it once more, a whole sweep after the reading it is
// measured against. That distance is what the instrument reads when the gem did
// not change, and it must stay within PATCH_SAME_MAX.
//
// THE CURSOR IS PARKED OFF THE PROBE CELL, since specs/ui.md marks the cell at
// `state.cursor` and a mark standing there would sit over all three readings
// alike.

import { afterEach, beforeEach, it } from "vitest";
import { quietRowsWithEscape, tokenOf, withCells } from "../board";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  CUTS,
  GEM_KINDS,
  PATCH_DISTINCT_MIN,
  PATCH_SAME_MAX,
} from "../constants";
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

/**
 * The kind the three cuts are carried on.
 *
 * specs/board.md requires the cuts be told apart and fixes no kind to read them
 * on; a cut sits with whatever kind its gem carries. The first of `GEM_KINDS`
 * carries them here, and nothing about the point depends on which one it is.
 */
const KIND = GEM_KINDS[0];

/**
 * The three cuts a gem carrying a kind can wear, in the order specs/board.md
 * holds `CUTS` in.
 *
 * The `prism` is the one cut of the four that specs/board.md gives no kind, so it
 * is not a cut OF this gem and is not posed here.
 */
const KINDED_CUTS = CUTS.filter((cut) => cut !== "prism");

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

/**
 * The three cuts side by side, posed for the `cuts` output alone.
 *
 * Written at every other column of one row so no two of them are neighbors: they
 * all carry one kind, and three of one kind on consecutive cells would be a run
 * under R4 standing on the board the still is taken of.
 */
const CUTS_ROW = withCells(
  BOARD,
  KINDED_CUTS.map((cut, at) => ({
    col: 1 + at * 2,
    row: 1,
    token: tokenOf(KIND, 0, cut),
  })),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a plain, a brilliant and a star of one kind apart from one another", async () => {
  await loadBoard(h, BOARD);
  await h.debug.setCursor(PARKED_COL, PARKED_ROW);
  await h.debug.clearSelection();
  await h.settle(ART_SETTLE_MS);
  await h.advance(1);

  // One cut after another into the same cell, a frame each so the build draws
  // what it was handed, and the pixels that frame left in the cell.
  const patches: Patch[] = [];
  for (const cut of KINDED_CUTS) {
    await h.debug.setGem(PROBE_COL, PROBE_ROW, tokenOf(KIND, 0, cut));
    await h.advance(1);
    patches.push(await readPatch(h, PROBE_COL, PROBE_ROW));
  }

  // The control: the first cut written back into the same cell, a full sweep
  // later than the reading it answers for.
  await h.debug.setGem(PROBE_COL, PROBE_ROW, tokenOf(KIND, 0, KINDED_CUTS[0]));
  await h.advance(1);
  const again = await readPatch(h, PROBE_COL, PROBE_ROW);

  // Evidence, and no part of the verdict: the three cuts on one board.
  await loadBoard(h, CUTS_ROW);
  await h.advance(1);
  await captureStill(h, "cuts");

  assertLessThanOrEqual(
    patchDistance(patches[0], again),
    PATCH_SAME_MAX,
    `how far cell (${PROBE_COL},${PROBE_ROW}) reads from itself with a ` +
      `${KINDED_CUTS[0]} ${KIND} written into it twice`,
  );

  for (let a = 0; a < KINDED_CUTS.length; a += 1) {
    for (let b = a + 1; b < KINDED_CUTS.length; b += 1) {
      assertGreaterThan(
        patchDistance(patches[a], patches[b]),
        PATCH_DISTINCT_MIN,
        `how far a ${KINDED_CUTS[a]} ${KIND} and a ${KINDED_CUTS[b]} ${KIND} ` +
          `read apart at cell (${PROBE_COL},${PROBE_ROW})`,
      );
    }
  }
});
