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
// WHAT IS READ, AND WHAT DELIBERATELY IS NOT. Acceptance alone, in the two
// places specs/rules.md shows it. The request is read with no frame advanced,
// where an accepted swap is `swapping` with `chainStep` still `0` and nothing
// refused; then the game is carried past `SWAP_SECONDS` (`0.18`), where the swap
// has landed and step 1 is `resolving`. A build that refused the request reaches
// neither reading. What the step SEEDS from a prism trade is R5's business and a
// different item's; nothing here reads the clear set, the score, or the board the
// step left.

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
import { SWAP_SECONDS } from "../constants";
import {
  advanceStep,
  captureReplay,
  createHarness,
  loadBoard,
  requestSwap,
  type Harness,
} from "../harness";

/** The run-free filler with a prism written into the middle of it. */
const ROWS: BoardRows = quietRowsWithEscape([{ col: 3, row: 3, token: "X0" }]);

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

  // The capture brackets the request and the animation that follows it, so the
  // evidence shows the prism crossing to its neighbor and the step it opens
  // rather than a still picture of the moment before it.
  await captureReplay(h, "swap", async () => {
    const taken = requestSwap(h, PAIR.a, PAIR.b);
    assertEqual(taken.phase, "swapping", "phase after the prism swap");
    assertEqual(taken.chainStep, 0, "chainStep after the prism swap");
    assertNull(taken.refusal, "refusal after the prism swap");

    // `advanceStep` reads the frames it needs off the state, so what carries the
    // board here is `SWAP_SECONDS` of game time rather than a count written down.
    const landed = await advanceStep(h);
    assertEqual(
      landed.phase,
      "resolving",
      `phase ${SWAP_SECONDS}s after the prism swap`,
    );
    assertEqual(
      landed.chainStep,
      1,
      `chainStep ${SWAP_SECONDS}s after the prism swap`,
    );
  });
});
