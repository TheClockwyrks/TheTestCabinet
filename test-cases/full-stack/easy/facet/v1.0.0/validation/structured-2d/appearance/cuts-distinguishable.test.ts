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
// WHY A SWEEP RATHER THAN A PAIR OF FRAMES. A cut gem is never still.
// specs/board.md says so outright — "A cut gem is never still" — and hands
// specs/assets.md the continuous effect that "is played at the cell of every
// `brilliant`, every `star`, and every `prism` standing on the board". So a
// `brilliant` read at one instant and a `star` read at another may be two
// instants of two running effects as readily as two treatments, and one pair of
// frames cannot tell which. The sweep answers the requirement instead of sampling
// it: each cut is written into one cell in turn, round after round, which leaves
// SAMPLES readings of each spread across the sweep, and EVERY cross-cut pair of
// them has to read more than PATCH_DISTINCT_MIN apart. A pair that agreed only
// because two effects happened to align would be one reading among many, and the
// others decide the point.
//
// WHY THE CONTROL IS TAKEN ON THE PLAIN GEM, AND BEFORE THE SWEEP. The control
// answers "what does the instrument read when the gem did not change", and a
// `brilliant` compared against itself answers "how far does its effect travel"
// instead — the very motion the sweep exists to look past. The plain gem is the
// one of the three that carries no running effect, so it is the one that can say
// what standing still reads as. It is read TWICE before the sweep begins, a whole
// sweep's worth of frames apart, with no cut having stood in the cell: a cut's
// effect is a system of particles with a life of their own, and a plain reading
// taken a frame after a `star` stood there could still be carrying them.
//
// NOTHING IS SELECTED THROUGH ANY OF IT, since specs/ui.md marks the cell at
// `state.selection` and a mark standing there would sit over every reading alike.

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

/**
 * How many times each cut is read: rounds of the sweep, one reading of each cut
 * per round.
 *
 * NOT a specification figure. Five rounds is fifteen frames of the suite's clock,
 * a quarter of a second of game time, which samples a running effect at fifteen
 * points of whatever it is doing rather than at one. It leaves twenty-five
 * readings behind for each of the three cross-cut pairs.
 */
const SAMPLES = 5;

/** Frames the sweep spends: one per cut, per round. */
const SWEEP_FRAMES = SAMPLES * KINDED_CUTS.length;

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

afterEach(() => {
  h?.dispose();
});

it("draws a plain, a brilliant and a star of one kind apart from one another", async () => {
  loadBoard(h, BOARD);
  h.debug.clearSelection();
  await h.settle(ART_SETTLE_MS);

  // The control, taken first and on the plain gem: the cell holding a stone with
  // no running effect at it, read twice a whole sweep apart. That is what the
  // instrument reads when nothing about the gem changed, and every distance below
  // is measured against the same box of pixels.
  h.debug.setGem(PROBE_COL, PROBE_ROW, tokenOf(KIND, 0, KINDED_CUTS[0]));
  await h.advance(1);
  const still = readPatch(h, PROBE_COL, PROBE_ROW);
  await h.advance(SWEEP_FRAMES);
  const stillAgain = readPatch(h, PROBE_COL, PROBE_ROW);

  // The sweep: one cut after another into the same cell, a frame each so the
  // build draws what it was handed, round after round.
  const byCut = new Map<string, Patch[]>(
    KINDED_CUTS.map((cut) => [cut, [] as Patch[]]),
  );
  for (let round = 0; round < SAMPLES; round += 1) {
    for (const cut of KINDED_CUTS) {
      h.debug.setGem(PROBE_COL, PROBE_ROW, tokenOf(KIND, 0, cut));
      await h.advance(1);
      (byCut.get(cut) as Patch[]).push(readPatch(h, PROBE_COL, PROBE_ROW));
    }
  }

  // Evidence, and no part of the verdict: the three cuts on one board.
  loadBoard(h, CUTS_ROW);
  await h.advance(1);
  captureStill(h, "cuts");

  assertLessThanOrEqual(
    patchDistance(still, stillAgain),
    PATCH_SAME_MAX,
    `how far cell (${PROBE_COL},${PROBE_ROW}) reads from itself over ` +
      `${SWEEP_FRAMES} frames with a ${KINDED_CUTS[0]} ${KIND} standing in it`,
  );

  for (let a = 0; a < KINDED_CUTS.length; a += 1) {
    for (let b = a + 1; b < KINDED_CUTS.length; b += 1) {
      const left = byCut.get(KINDED_CUTS[a]) as Patch[];
      const right = byCut.get(KINDED_CUTS[b]) as Patch[];
      for (let i = 0; i < left.length; i += 1) {
        for (let j = 0; j < right.length; j += 1) {
          assertGreaterThan(
            patchDistance(left[i], right[j]),
            PATCH_DISTINCT_MIN,
            `how far a ${KINDED_CUTS[a]} ${KIND} read at sample ${i + 1} and a ` +
              `${KINDED_CUTS[b]} ${KIND} read at sample ${j + 1} stand apart at ` +
              `cell (${PROBE_COL},${PROBE_ROW})`,
          );
        }
      }
    }
  }
});
