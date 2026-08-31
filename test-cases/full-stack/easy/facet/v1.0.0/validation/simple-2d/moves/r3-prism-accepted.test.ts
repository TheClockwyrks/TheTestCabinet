// Facet — moves/r3-prism-accepted: R3 accepts a swap that moves a prism.
//
// R3 in specs/rules.md has two doors, and this is the second: a swap is accepted
// "when the board it produces carries at least one maximal run under R4, OR when
// at least one of the two cells holds a `prism`". A build that implements only
// the first door has a prism it can never move — the one gem whose whole purpose
// is to be traded — and every board that deals one is quietly poorer for it.
//
// THE SCENARIO CLOSES THE FIRST DOOR SO THE SECOND IS THE ONLY WAY IN. A prism
// is written into the run-free filler, and the cell it is traded with is chosen
// so the board the exchange produces carries NO maximal run at all. The fixture
// assertions prove exactly that: no run before, no run after, and a prism on one
// of the two cells. So a build that accepts this request accepted it for the
// prism, and one that refuses it is applying only half of R3.
//
// WHAT IS READ, AND WHAT DELIBERATELY IS NOT. Acceptance alone: phase
// `resolving` at chainStep 1 with nothing refused, read with no frame advanced,
// exactly as "A chain step" describes an accepted swap. What the step SEEDS from
// a prism trade is R5's business and a different item's; nothing here reads the
// clear set, the score, or the board the step left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull, assertTrue } from "../assert";
import {
  areAdjacent,
  isPrism,
  maximalRuns,
  quietRowsWithEscape,
  swapWouldMatch,
  type BoardRows,
  type CellRef,
} from "../board";
import { FRAMES_PER_STEP } from "../constants";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swap,
  type Harness,
} from "../harness";

/** The run-free filler with a prism written into the middle of it. */
const ROWS: BoardRows = quietRowsWithEscape([
  { col: 3, row: 3, token: "X0" },
]);

/** The prism at `(3,3)`, traded with the plain jade orthogonally beside it. */
const PAIR: { a: CellRef; b: CellRef } = {
  a: { col: 3, row: 3 },
  b: { col: 4, row: 3 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("accepts an exchange that moves a prism and makes no run", async () => {
  // The fixture. The middle assertion is the one that makes this item about the
  // prism: if the exchange made a run, R3's first door would already be open and
  // acceptance would say nothing about the second.
  assertTrue(areAdjacent(PAIR.a, PAIR.b), "the pair is orthogonally adjacent");
  assertLength(maximalRuns(ROWS), 0, "runs on the posed board");
  assertTrue(
    !swapWouldMatch(ROWS, PAIR.a, PAIR.b),
    "the exchange makes NO maximal run",
  );
  assertTrue(isPrism(ROWS, PAIR.a), "the first cell holds a prism");

  loadBoard(h, ROWS);

  const taken = await captureReplay(h, "swap", async () => {
    const reading = swap(h, PAIR.a, PAIR.b);
    // One step's worth of frames after the request, so the evidence shows the
    // step the prism opened rather than the instant before it.
    await h.advance(FRAMES_PER_STEP);
    return reading;
  });

  assertEqual(taken.phase, "resolving", "phase after the prism swap");
  assertEqual(taken.chainStep, 1, "chainStep after the prism swap");
  assertNull(taken.refusal, "refusal after the prism swap");
});
