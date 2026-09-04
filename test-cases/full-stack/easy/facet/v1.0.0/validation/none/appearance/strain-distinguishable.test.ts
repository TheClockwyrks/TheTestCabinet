// Facet — appearance/strain-distinguishable: the four strain states of a gem are
// drawn apart from one another, so a flawed gem stands apart from every unflawed
// one.
//
// WHAT IS BEING DECIDED. specs/board.md makes strain a whole number from 0 to
// MAX_STRAIN (3) and requires that "A gem's strain is readable without counting
// slowly, and a flawed gem is unmistakable", with "the four strain states are
// told apart from one another". specs/overview.md holds the same four to the same
// bar — "A gem's four strain states read as damage deepening from clean to
// flawed, and a flawed gem stands apart from every unflawed one on the board". No
// palette, no crack pattern and no ordering of severity is read here: the one
// question with a yes/no answer is whether any two of the four are drawn the
// SAME, and that is what this decides. A build that draws strain 1 and strain 2
// identically leaves a player counting nothing, and it fails here.
//
// HOW ONE CELL DECIDES IT. Every reading is taken at ONE cell of one posed board,
// with one strain state after another written into that cell through `setGem`,
// which specs/instrumentation.md defines as touching that cell alone. The kind
// and the cut are held fixed across all four, and so is everything around the
// cell — the same neighbors, the same board frame, the same background, the same
// box of device pixels — so the distance between two readings is the distance
// between two strain states of one gem and nothing else.
//
// STRAIN RAISES NO RUNNING EFFECT, WHICH IS WHY THIS IS A STILL COMPARISON.
// specs/board.md gives the continuous effect to the three cuts and says outright
// that "A gem's strain raises no such effect: damage is read off the stone
// itself." All four gems read here are `plain`, so all four are stones entitled
// to stand still, and a pair of frames decides them. The cuts, which are never
// still, are read by `appearance/cuts-distinguishable` across a sweep instead.
//
// THE CONTROL THAT MAKES THE READING MEAN SOMETHING. A build is entitled to an
// idle animation, so two readings of one cell taken frames apart need not be
// identical. The sweep therefore ends by writing the first state back into that
// same cell and reading it once more, a whole sweep after the reading it is
// measured against — a span at least as long as any pair below. That distance is
// what the instrument reads when the gem did not change, and it must stay within
// PATCH_SAME_MAX.
//
// NOTHING IS SELECTED THROUGH ANY OF IT, since specs/ui.md marks the cell at
// `state.selection` and a mark standing there would sit over all four readings
// alike.

import { afterEach, beforeEach, it } from "vitest";
import { quietRowsWithEscape, tokenOf, withCells } from "../board";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  GEM_KINDS,
  MAX_STRAIN,
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

/**
 * The kind carried through the sweep.
 *
 * specs/board.md fixes what strain is and requires that its four states be told
 * apart; it fixes no kind to read them on, and the four states are the same four
 * on every kind. The first of `GEM_KINDS` carries them here, and nothing about
 * the point depends on which one it is.
 */
const KIND = GEM_KINDS[0];

/** The four strain states, `0` to `MAX_STRAIN`, in the order specs/board.md counts them. */
const STRAINS = Array.from({ length: MAX_STRAIN + 1 }, (_unused, at) => at);

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
 * The four states side by side, posed for the `strain` output alone.
 *
 * Written at every other column of one row so no two of them are neighbors: they
 * all carry one kind, and three of one kind on consecutive cells would be a run
 * under R4 standing on the board the still is taken of.
 */
const STRAIN_ROW = withCells(
  BOARD,
  STRAINS.map((strain, at) => ({
    col: 1 + at * 2,
    row: 1,
    token: tokenOf(KIND, strain),
  })),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`draws all ${MAX_STRAIN + 1} strain states of one gem apart from one another`, async () => {
  await loadBoard(h, BOARD);
  await h.debug.clearSelection();
  await h.settle(ART_SETTLE_MS);
  await h.advance(1);

  // One strain state after another into the same cell, a frame each so the build
  // draws what it was handed, and the pixels that frame left in the cell.
  const patches: Patch[] = [];
  for (const strain of STRAINS) {
    await h.debug.setGem(PROBE_COL, PROBE_ROW, tokenOf(KIND, strain));
    await h.advance(1);
    patches.push(await readPatch(h, PROBE_COL, PROBE_ROW));
  }

  // The control: the first state written back into the same cell, a full sweep
  // later than the reading it answers for.
  await h.debug.setGem(PROBE_COL, PROBE_ROW, tokenOf(KIND, STRAINS[0]));
  await h.advance(1);
  const again = await readPatch(h, PROBE_COL, PROBE_ROW);

  // Evidence, and no part of the verdict: the four states on one board.
  await loadBoard(h, STRAIN_ROW);
  await h.advance(1);
  await captureStill(h, "strain");

  assertLessThanOrEqual(
    patchDistance(patches[0], again),
    PATCH_SAME_MAX,
    `how far cell (${PROBE_COL},${PROBE_ROW}) reads from itself with a ` +
      `${KIND} at strain ${STRAINS[0]} written into it twice`,
  );

  for (let a = 0; a < STRAINS.length; a += 1) {
    for (let b = a + 1; b < STRAINS.length; b += 1) {
      assertGreaterThan(
        patchDistance(patches[a], patches[b]),
        PATCH_DISTINCT_MIN,
        `how far a ${KIND} at strain ${STRAINS[a]} and a ${KIND} at strain ` +
          `${STRAINS[b]} read apart at cell (${PROBE_COL},${PROBE_ROW})`,
      );
    }
  }
});
