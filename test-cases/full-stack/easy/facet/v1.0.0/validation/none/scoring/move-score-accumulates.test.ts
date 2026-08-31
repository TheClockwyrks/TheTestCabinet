// Facet — scoring/move-score-accumulates: `moveScore` holds what the move
// currently running has scored, and it empties at the next accepted swap.
//
// specs/rules.md opens its table of the three figures a level is measured by with
// this one: "`moveScore` — The points every step of the move currently running
// has scored. It returns to `0` when a swap is accepted." A move is "one accepted
// swap together with the whole chain it sets off", so the figure has two halves,
// and a build can hold either one without the other: it can add each step's
// points and never empty the figure between moves, in which case it is a second
// running total and not a move's score at all; or it can empty it and then report
// only the last step, in which case a five-step cascade reads as whatever its
// final step happened to take.
//
// HOW THE ACCUMULATION IS READ, AND WHY AGAINST THE BUILD'S OWN FIGURES. The
// chain is driven one step boundary at a time, and after each step `moveScore` is
// required to equal the running total of the `lastPoints` that step reported.
// Reading it against the step's OWN reported points is what keeps this point
// about the ACCUMULATION rather than about the rates, which are three points
// above: a build that prices a clear set wrongly reports its own figure
// consistently and fails only where the rates are decided, while a build that
// adds them up wrongly fails here whatever its rates are.
//
// THE SCENARIO IS A REAL CASCADE. A chain step's number cannot be posed, so the
// board is arranged for a second step to happen on its own: three rubies in
// column 3 are cleared by the swap, and the two jades above them fall onto the
// jade below to make a column of three on the board the next read finds. All
// three cells of that second run are SURVIVORS of the first step rather than
// refills, so the cascade runs whatever the build's seeded generator dealt into
// the top of the column. The loop reads every step the chain actually takes, so a
// build whose refill happened to seed a third is measured over that step too.
//
// THE SECOND HALF NEEDS A SECOND MOVE, AND A BOARD TO PLAY IT ON. The scenario is
// posed with the spare legal swap `board.ts` plants in the bottom-left corner,
// and its own cells are clear of that corner — the whole chain runs in column 3 —
// so a legal swap is still standing when the chain settles. WHICH swap is read
// off the board the chain ACTUALLY settled on rather than written down here,
// because R9's refill is the build's own draw, and it is read through `board.ts`'s
// restatement of R1 and R3 rather than through the build's `legalSwap` flag,
// which is `levels/legal-swap-derived`'s point and not this one's.
//
// WHEN THE FIGURE IS READ AFTERWARDS. On the accepting frame, before the new
// move's own first step has resolved: an accepted swap exchanges the two cells at
// once, sets `phase` to `swapping` with `chainStep` at `0`, and clears nothing
// until `SWAP_SECONDS` (`0.18`) of game time has passed. `phase` is read beside
// the figure, so a swap that was REFUSED cannot pass for an accepted one that
// emptied it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertTrue,
} from "../assert";
import { MAX_CHAIN_STEPS } from "../constants";
import {
  legalSwapExists,
  legalSwaps,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  advanceStep,
  captureReplay,
  createHarness,
  loadBoard,
  requestSwap,
  swapAndStep,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/**
 * A ruby three in column 3 that the swap completes, with jades above and below it
 * arranged so R9's settling lands three jades in a column and the next board read
 * finds a run of its own.
 *
 * The jade at `(3,5)` sits under the run and does not move; the two above fall
 * onto it. Nothing here is three of a kind before the swap, and the whole chain
 * stays inside column 3, well clear of the bottom-left corner the spare legal
 * swap is planted in.
 */
const CHAIN_CELLS: readonly PlacedToken[] = [
  { col: 3, row: 0, token: "J0" },
  { col: 3, row: 1, token: "J0" },
  { col: 3, row: 2, token: "R0" },
  { col: 2, row: 3, token: "R0" },
  { col: 3, row: 4, token: "R0" },
  { col: 3, row: 5, token: "J0" },
];

/** The swap that slides the waiting ruby into the column and completes the run. */
const SWAP_A: CellRef = { col: 2, row: 3 };
const SWAP_B: CellRef = { col: 3, row: 3 };

/** The depth the arrangement is built to reach, and the point's own premise. */
const CASCADE_DEPTH = 2;

/** One step of the move, as the check tots it up. */
interface StepReading {
  chainStep: number;
  /** The running total of every `lastPoints` reported up to and including it. */
  running: number;
  /** What the build reported as `moveScore` at that step. */
  moveScore: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("tots up every step of the running move and empties at the next swap", async () => {
  const posed = quietRowsWithEscape(CHAIN_CELLS);
  // The fixture's own guarantees, asserted before the build is asked anything:
  // the posed board carries no run of its own, the swap is one R1 and R3 both
  // accept, and the only run it makes is the first step's.
  assertEqual(maximalRuns(posed).length, 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertEqual(
    maximalRuns(swapped(posed, SWAP_A, SWAP_B)).length,
    1,
    "maximal runs the swap makes",
  );

  await loadBoard(h, posed);

  // The whole drive is recorded, and `captureReplay` writes what it captured
  // even from a scenario that failed, so an assertion inside it still leaves the
  // evidence that shows why.
  const drive = await captureReplay(h, "move", async () => {
    const readings: StepReading[] = [];
    let running = 0;
    let deepest = 0;
    // `swapAndStep` carries the board through the swap animation to step 1's
    // result; `advanceStep` then carries it past one step boundary at a time,
    // reading each step's own `stepHold` off the snapshot rather than counting a
    // fixed number of frames.
    let reading: FacetSnapshot = await swapAndStep(h, SWAP_A, SWAP_B);
    for (let boundary = 0; boundary <= MAX_CHAIN_STEPS; boundary += 1) {
      // A reading at a step the chain had not reached before is that step's own
      // result, and `lastPoints` is what that step scored.
      if (reading.chainStep > deepest) {
        deepest = reading.chainStep;
        running += reading.lastPoints;
        readings.push({
          chainStep: reading.chainStep,
          running,
          moveScore: reading.moveScore,
        });
      }
      if (reading.phase === "idle") break;
      reading = await advanceStep(h);
    }
    const settled = reading;

    // The board the move came to rest on, and the swap that opens the next move,
    // read off that board rather than written down.
    const settledBoard = await h.board();
    assertTrue(
      legalSwapExists(settledBoard),
      "a legal swap on the board the chain settled on",
    );
    const available = legalSwaps(settledBoard);
    const next = available[0];
    const accepted = await requestSwap(h, next.a, next.b);
    // One frame of the new move in motion, so the replay ends on the two gems
    // travelling rather than on a board standing still. It is `0.015625` s, far
    // inside `SWAP_SECONDS`, so nothing the reading above holds can change.
    await h.advance(1);
    return { readings, deepest, settled, accepted };
  });

  const { readings, deepest, settled, accepted } = drive;

  // The chain really cascaded, so the accumulation has more than one step in it.
  assertGreaterThanOrEqual(
    deepest,
    CASCADE_DEPTH,
    "the deepest chain step the move reached",
  );
  assertEqual(settled.phase, "idle", "the phase the move came to rest in");

  // Each step of the move: the figure holds the sum of every step's own reported
  // points, up to and including that one.
  for (const step of readings) {
    assertEqual(
      step.moveScore,
      step.running,
      `the move score at chain step ${step.chainStep}, against the running ` +
        `total of the points each step of the move reported`,
    );
  }

  // The move scored something. A move worth nothing would satisfy the equality
  // above and the emptying below without either meaning anything.
  assertGreaterThan(settled.moveScore, 0, "the points the whole move scored");

  // And the next accepted swap empties it.
  assertEqual(
    accepted.phase,
    "swapping",
    "the phase the second swap left, which says it was accepted",
  );
  assertEqual(
    accepted.chainStep,
    0,
    "the chain step the accepted swap opened at, before anything resolves",
  );
  assertEqual(
    accepted.moveScore,
    0,
    "the move score on the frame the second swap was accepted, before that " +
      "move has scored anything",
  );
});
