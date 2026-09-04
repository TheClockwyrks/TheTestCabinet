// chain/chain-ends-idle — a chain ends when nothing more clears.
//
// specs/rules.md gives the step boundary two outcomes, and this is the other one:
// "Otherwise `phase` returns to `idle`, `chainStep` returns to `0`, and the level
// and end conditions below are evaluated." specs/instrumentation.md says the same
// of the reading — "`chainStep` and `stepTimer` are `0` while `phase` is not
// `resolving`" — so a build that leaves the chain counter standing, or the timer
// still holding the overrun it stopped on, is reporting a chain that is not
// running as though it were.
//
// THE BOARD IS DRIVEN TO ITS OWN END RATHER THAN FOR A FIXED NUMBER OF STEPS.
// R9 refills the top of every cleared column from the game's own seeded
// generator, and a refill is entitled to deal a run of its own; a check that
// insisted the chain end after exactly one step would be asserting the deal. So
// the chain is carried to wherever it settles, the board it settled on is read
// for a clear set under R5 and R6, and the point is that the settling and the
// empty clear set are the same event: nothing more seeded, so the chain ended.
//
// HOW IT IS CARRIED. `swapAndStep` drives the swap animation — the accepted swap
// exchanges the two cells at once and holds in `swapping` until `swapTimer`
// reaches `SWAP_SECONDS` (`0.18`), when step 1 resolves — and `resolveChain`
// then carries past one step boundary at a time, each sized from that step's own
// reported `stepHold` rather than from a constant. It always returns: a build
// whose chain never settles comes back as `settled: false` and fails here
// instead of hanging.
//
// THEN TIME KEEPS RUNNING. A build that returns to `idle` and then reads the
// board again anyway, or lets `stepTimer` go on accumulating while nothing is
// resolving, is caught by driving two steps' worth of frames over a settled
// board and finding it exactly as it was left. Two steps' worth is measured from
// the hold the settled board itself reports: `stepHold` is
// `lastWaves * WAVE_SECONDS` plus `lastFall * FALL_SECONDS_PER_ROW` plus
// `STEP_SECONDS`, so it is at least `STEP_SECONDS` whatever the last step did,
// and twice the frames that carry past it is more than two steps of any shape.
//
// Everything crosses into the page, so every reading is awaited. The
// scenario itself is the specification's, and reads the same under all three
// engines.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  assertBoardEquals,
  clearSetFromRuns,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  framesPast,
  loadBoard,
  resolveChain,
  swapAndStep,
  type Harness,
} from "../harness";

/** One run of three across row 4, completed by trading the ruby at (6,4) in. */
const RUN: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/** Steps' worth of frames driven over the settled board, to prove it is done. */
const IDLE_STEPS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to idle with chainStep and stepTimer at 0 once nothing seeds", async () => {
  const posed = quietRowsWithEscape(RUN);
  // The fixture's own guarantees. The escape swap in the far corner is what
  // keeps a round on the board once this chain is spent, and the scenario is
  // clear of it, so the board this settles on is a live one.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertLength(
    maximalRuns(swapped(posed, SWAP_A, SWAP_B)),
    1,
    "maximal runs the swap makes",
  );

  await loadBoard(h, posed);
  const first = await swapAndStep(h, SWAP_A, SWAP_B);
  assertEqual(first.chainStep, 1, "the chain step the swap resolved into");
  assertEqual(first.phase, "resolving", "the phase step 1 resolved in");

  const settled = await captureReplay(h, "settled", () => resolveChain(h));

  // The chain ended of its own accord rather than being driven to the cap.
  assertTrue(settled.settled, "the chain reached idle within the step cap");
  assertEqual(settled.snapshot.phase, "idle", "phase where the chain ended");
  assertEqual(settled.snapshot.chainStep, 0, "chainStep where the chain ended");
  assertEqual(settled.snapshot.stepTimer, 0, "stepTimer where the chain ended");

  // And it ended for the reason the rule gives: the board it came to rest on
  // seeds nothing under R5, so R6 closes over an empty seed and there is no
  // clear set for a further step to remove.
  const rested = await h.board();
  assertLength(
    clearSetFromRuns(rested),
    0,
    "the clear set the rested board seeds",
  );

  // Time keeps running over a settled board, and nothing moves: no further board
  // read, no chain, and a timer that stays at rest rather than accumulating.
  await h.advance(IDLE_STEPS * framesPast(settled.snapshot.stepHold));
  const later = await h.snapshot();
  assertEqual(later.phase, "idle", "phase two steps later");
  assertEqual(later.chainStep, 0, "chainStep two steps later");
  assertEqual(later.stepTimer, 0, "stepTimer two steps later");
  assertBoardEquals(await h.board(), rested, "the board two steps later");
});
