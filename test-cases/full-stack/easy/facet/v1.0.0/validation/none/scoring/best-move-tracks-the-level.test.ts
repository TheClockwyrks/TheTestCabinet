// Facet — scoring/best-move-tracks-the-level: `bestMove` is the greater of what
// it held and what the move just finished scored.
//
// specs/rules.md, the second row of the table of figures a level is measured by:
// "`bestMove` — The most points one move has scored in the current level, and `0`
// until a move has scored. When `phase` returns to `idle`, `bestMove` becomes the
// greater of itself and `moveScore`." Two clauses, and a build can hold one and
// not the other: one that ASSIGNS rather than maximizes reports the last move
// instead of the best, and a player's finest cascade is overwritten by the next
// three-in-a-row they play; one that never takes the figure at all leaves the
// `levelclear` screen reporting `0` beside a level the player worked through.
//
// BOTH DIRECTIONS, FROM ONE POSED FIGURE. The same move is driven twice from the
// same posed board. The first time `bestMove` is posed through `setBestMove` far
// above anything the move can pay, so the standing figure is the greater of the
// two and must come through the move untouched. The second time it is posed at
// `0`, so the move's own score is the greater and must be what the figure ends
// at. Posing the standing figure is what supplies the losing direction without
// hunting a board that scores some particular amount, and both directions belong
// to one point because the maximum is one rule.
//
// THE TWO DRIVES ARE NOT REQUIRED TO SCORE ALIKE. The board and the swap are the
// same, but the generator has advanced by the time the second drive runs, so R9's
// refill deals differently and the chain may not run to the same depth. Each
// drive is therefore measured against its OWN `moveScore`, read out of the same
// snapshot as the `bestMove` it is compared with, rather than against the other
// drive's figure.
//
// WHEN THE READING IS TAKEN. Once `phase` has returned to `idle`, which is when
// specs/rules.md says the figure is taken. `swapAndResolve` carries the board
// through the swap animation, through step 1, and past one step boundary at a
// time — each sized from the step's own reported `stepHold` — until the chain
// comes to rest, and it reports whether it ever did, so a build whose chain never
// settles fails saying that rather than hanging.
//
// THE SCENARIO IS A REAL MOVE. Three rubies in column 3 are cleared by the swap,
// and the two jades above them fall onto the jade below to make a column of three
// on the board the next read finds — all three of those cells survivors of the
// first step rather than refills, so the move is worth more than one step's
// points whatever the build dealt. The spare legal swap in the bottom-left corner
// keeps the round alive as each chain settles, and the scenario's own cells stay
// inside column 3, clear of that corner.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  FLAWED_SCORE,
  GRID_COLS,
  GRID_ROWS,
  MAX_MULTIPLIER,
} from "../constants";
import {
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
  loadBoard,
  swapAndResolve,
  type Harness,
} from "../harness";

/**
 * A ruby three in column 3 that the swap completes, with jades above and below it
 * arranged so R9's settling lands three jades in a column and the next board read
 * finds a run of its own.
 *
 * The jade at `(3,5)` sits under the run and does not move; the two above fall
 * onto it. Nothing here is three of a kind before the swap.
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

/**
 * The most any one chain step could conceivably pay, by specs/rules.md's own
 * figures: every cell of the board in the clear set, every one of them flawed,
 * at the greatest multiplier the table allows.
 */
const STEP_CEILING = GRID_COLS * GRID_ROWS * FLAWED_SCORE * MAX_MULTIPLIER;

/**
 * The standing figure the losing direction is posed with: ten times that
 * ceiling.
 *
 * The move this board plays clears six cells over two steps, so the figure is
 * unreachable by a wide margin — and the check asserts the relation it actually
 * needs, that the standing figure is above what the move scored, rather than
 * resting on the arithmetic.
 */
const POSED_BEST = 10 * STEP_CEILING;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the greater of the standing figure and the move just played", async () => {
  const posed = quietRowsWithEscape(CHAIN_CELLS);
  // The fixture's own guarantees: the posed board carries no run of its own, the
  // swap is one R1 and R3 both accept, and the only run it makes is the first
  // step's.
  assertEqual(maximalRuns(posed).length, 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertEqual(
    maximalRuns(swapped(posed, SWAP_A, SWAP_B)).length,
    1,
    "maximal runs the swap makes",
  );

  // The losing direction: a standing figure the move cannot beat.
  await loadBoard(h, posed);
  await h.debug.setBestMove(POSED_BEST);
  assertEqual(
    (await h.snapshot()).bestMove,
    POSED_BEST,
    "the standing best move the drive opens on",
  );
  const standing = await swapAndResolve(h, SWAP_A, SWAP_B);

  assertTrue(
    standing.settled.settled,
    "the chain reached idle within the step cap on the first drive",
  );
  assertEqual(
    standing.settled.snapshot.phase,
    "idle",
    "the phase the first move came to rest in",
  );
  // The scenario's own premise: the move really did score less than the figure
  // standing over it, so this drive really is the losing direction.
  assertGreaterThan(
    standing.settled.snapshot.moveScore,
    0,
    "the points the first move scored",
  );
  assertGreaterThan(
    POSED_BEST,
    standing.settled.snapshot.moveScore,
    "the standing figure, against the points the move under it scored",
  );
  assertEqual(
    standing.settled.snapshot.bestMove,
    POSED_BEST,
    "the best move once a smaller move has settled under it",
  );

  // The winning direction: the same move, with nothing standing over it. The
  // board is posed afresh and the figure returned to 0, which `setBestMove`
  // changes nothing else to do.
  await loadBoard(h, posed);
  await h.debug.setBestMove(0);
  assertEqual(
    (await h.snapshot()).bestMove,
    0,
    "the standing best move the second drive opens on",
  );

  const raised = await captureReplay(h, "best", () =>
    swapAndResolve(h, SWAP_A, SWAP_B),
  );

  assertTrue(
    raised.settled.settled,
    "the chain reached idle within the step cap on the second drive",
  );
  assertEqual(
    raised.settled.snapshot.phase,
    "idle",
    "the phase the second move came to rest in",
  );
  assertGreaterThan(
    raised.settled.snapshot.moveScore,
    0,
    "the points the second move scored",
  );
  assertEqual(
    raised.settled.snapshot.bestMove,
    raised.settled.snapshot.moveScore,
    "the best move once a move has settled over a standing 0, which is that " +
      "move's own score",
  );
});
