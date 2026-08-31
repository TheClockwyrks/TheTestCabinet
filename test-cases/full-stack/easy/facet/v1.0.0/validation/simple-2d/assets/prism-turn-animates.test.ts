// assets/prism-turn-animates — a prism standing on a settled board turns.
//
// specs/assets.md, "Animations — draw-sheet": "The prism's idle turn, a short
// looping sequence in which the cut rotates and catches the light. Loop it for
// every prism standing on the board, so a prism is picked out from the stones
// around it by its motion as well as its art." The turn is IDLE motion: it runs
// while nothing is happening, which is what makes it readable at all.
//
// WHAT IS READ. The pixels the build actually put on the canvas inside the
// prism's own cell, at a series of instants across two seconds of game time. The
// box is `PATCH_HALF` (20) logical units either side of the cell center, which
// sits inside `GEM_R` (30) — where specs/board.md says a gem's drawn form is — and
// well inside half of `CELL_PITCH` (36), so no neighboring cell reaches into it.
// A turning cut changes those pixels; a still picture of a prism does not.
//
// WHY THE BOARD IS AT REST. The board carries no maximal run and no swap is made,
// so `phase` never leaves `idle` and nothing on the board is falling, clearing or
// settling. Any change inside the prism's cell is therefore the idle loop the
// specification asks for rather than the tail of a chain — which is what makes
// this a reading about the turn rather than about the board.
//
// THE MEASURE, AND WHY IT IS THE CASE'S OWN. `patchDistance` is the mean
// per-pixel RGB distance the suite reads every appearance point at, and
// `PATCH_SAME_MAX` is the distance below which the case calls two patches the
// same picture. So a build passes when at least one sampled instant is NOT the
// same picture as the first — a change large enough that the case would not call
// the two identical. It says nothing about the palette, the form, the direction
// of the rotation or the length of the loop, all of which are the build's.
//
// The prism sits away from the cursor's opening cell, so the mark the cursor
// draws is nowhere near the box being read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { PATCH_SAME_MAX } from "../constants";
import {
  hasPrism,
  isPrism,
  maximalRuns,
  quietRowsWith,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  patchDistance,
  type Harness,
  type Patch,
} from "../harness";

/** Where the prism stands: clear of the cursor's opening cell at (0,0). */
const PRISM: CellRef = { col: 3, row: 3 };

/** The one cell written over the run-free filler: a prism at strain 0. */
const CELLS: readonly PlacedToken[] = [
  { col: PRISM.col, row: PRISM.row, token: "X0" },
];

/**
 * How the cell is watched: how many instants are sampled, and how many frames of
 * the suite's 64 Hz clock separate two of them.
 *
 * Eight frames is an eighth of a second, and seventeen samples span two whole
 * seconds of game time. A "short looping sequence" that showed the same picture
 * at every one of those instants would be a loop no player could see turning.
 */
const SAMPLES = 17;
const FRAMES_BETWEEN = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("changes the pixels in a prism's cell while the board rests", async () => {
  const posed = quietRowsWith(CELLS);

  // The scenario, established before the build is asked anything: one prism on
  // the board, at the cell the pixels will be read from, and no run anywhere —
  // so the board the build is handed is one that resolves nothing.
  assertTrue(hasPrism(posed), "a prism on the posed board");
  assertTrue(isPrism(posed, PRISM), "a prism at the cell being watched");
  assertEqual(maximalRuns(posed).length, 0, "maximal runs on the posed board");

  const settled = loadBoard(h, posed);
  assertEqual(settled.phase, "idle", "the phase a run-free posed board rests in");

  const samples = await captureReplay(h, "turn", async () => {
    const taken: Patch[] = [];
    for (let index = 0; index < SAMPLES; index += 1) {
      await h.advance(FRAMES_BETWEEN);
      taken.push(h.patch(PRISM.col, PRISM.row));
    }
    return taken;
  });

  // Nothing moved the board while the cell was watched, so the whole of what
  // separates one instant from another is what the prism itself drew.
  const resting = h.snapshot();
  assertEqual(resting.phase, "idle", "the phase after the cell was watched");

  // The turn is looping when at least one instant is a different picture from
  // the first by the case's own reading of "a different picture".
  const moved = Math.max(
    ...samples.slice(1).map((patch) => patchDistance(samples[0], patch)),
  );
  assertGreaterThan(
    moved,
    PATCH_SAME_MAX,
    "the largest mean per-pixel distance between the prism's cell at the " +
      "first sampled instant and any later one",
  );
});
