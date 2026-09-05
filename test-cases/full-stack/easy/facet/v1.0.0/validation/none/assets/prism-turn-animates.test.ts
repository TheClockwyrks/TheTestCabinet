// assets/prism-turn-animates — a prism standing on a settled board turns.
//
// specs/assets.md, "Animations — draw-sheet": "The prism's idle turn, a short
// looping sequence in which the cut rotates and catches the light. Loop it for
// every prism standing on the board, so a prism is picked out from the stones
// around it by its motion as well as its art." The turn is IDLE motion: it runs
// while nothing is happening, which is what makes it readable at all.
//
// WHAT IS READ. The pixels the build actually put on the canvas inside the
// prism's own cell, at a series of instants across a second of game time. The box
// is `PATCH_HALF` (20) logical units either side of the cell center, which sits
// inside `GEM_R` (30) — where specs/board.md says a gem's drawn form is — and well
// inside half of `CELL_PITCH` (36), so no neighboring cell reaches into it. A
// turning cut changes those pixels; a still picture of a prism does not.
//
// WHY THE BOARD IS AT REST. The board carries no maximal run and no swap is made,
// so `phase` never leaves `idle` and nothing on the board is falling, clearing or
// settling. Any change inside the prism's cell is therefore something the build
// is running at that stone rather than the tail of a chain — which is what makes
// this a reading about a produced sequence rather than about the board.
//
// WHAT THE READING CANNOT SEPARATE, AND WHY THAT IS THE HONEST BOUND. A prism is
// the one gem specs/assets.md gives two running things: this idle turn, and the
// cut aura it runs "at the cell of every `brilliant`, every `star`, and every
// `prism` standing on the board". Nothing in the pixels tells a looping sheet from
// a running particle system, so a build that produced one of the two and not the
// other answers this spuriously — a false pass, never a false failure. What the
// point rules out is the build specs/assets.md's closing list names, the one that
// "leaves a cut stone standing still". The aura's own point,
// `assets/cut-aura-animates`, reads a `brilliant` instead, which carries no
// produced sequence of its own and so can only be moving because of the aura.
//
// THE MEASURE. `patchDistance` is the mean per-pixel RGB distance between two
// readings of one box, and the reading is whether it is zero: a build passes
// when at least one sampled instant is not the same picture as the first. How
// far the picture travelled, the palette, the form, the direction of the
// rotation and the length of the loop are all the build's, and none is read.
//
// Nothing is selected while the cell is watched: specs/ui.md marks the cell at
// `state.selection`, and `loadBoard` leaves nothing selected.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
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

/** Where the prism stands: mid-board, so its box is cut whole. */
const PRISM: CellRef = { col: 3, row: 3 };

/** The one cell written over the run-free filler: a prism at strain 0. */
const CELLS: readonly PlacedToken[] = [
  { col: PRISM.col, row: PRISM.row, token: "X0" },
];

/**
 * How the cell is watched: how many instants are sampled, and how many frames of
 * the suite's 64 Hz clock separate two of them.
 *
 * Four frames is a sixteenth of a second, and seventeen samples span one whole
 * second of game time. A "short looping sequence" that showed the same picture at
 * every one of those instants would be a loop no player could see turning.
 */
const SAMPLES = 17;
const FRAMES_BETWEEN = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes the pixels in a prism's cell while the board rests", async () => {
  const posed = quietRowsWith(CELLS);

  // The scenario, established before the build is asked anything: one prism on
  // the board, at the cell the pixels will be read from, and no run anywhere —
  // so the board the build is handed is one that resolves nothing.
  assertTrue(hasPrism(posed), "a prism on the posed board");
  assertTrue(isPrism(posed, PRISM), "a prism at the cell being watched");
  assertEqual(maximalRuns(posed).length, 0, "maximal runs on the posed board");

  const settled = await loadBoard(h, posed);
  assertEqual(
    settled.phase,
    "idle",
    "the phase a run-free posed board rests in",
  );

  const samples = await captureReplay(h, "turn", async () => {
    // One frame first, so the canvas is holding the board that was posed rather
    // than whatever the frame before the pose left on it.
    await h.advance(1);
    const taken: Patch[] = [];
    for (let index = 0; index < SAMPLES; index += 1) {
      if (index > 0) await h.advance(FRAMES_BETWEEN);
      taken.push(await h.patch(PRISM.col, PRISM.row));
    }
    return taken;
  });

  // Nothing moved the board while the cell was watched, so the whole of what
  // separates one instant from another is what the build drew at that stone.
  const resting = await h.snapshot();
  assertEqual(resting.phase, "idle", "the phase after the cell was watched");

  // The turn is looping when at least one instant is a different picture from
  // the first by the case's own reading of "a different picture".
  const moved = Math.max(
    ...samples.slice(1).map((patch) => patchDistance(samples[0], patch)),
  );
  assertGreaterThan(
    moved,
    0,
    "the largest mean per-pixel distance between the prism's cell at the " +
      "first sampled instant and any later one",
  );
});
