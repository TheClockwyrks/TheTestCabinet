// chain/swap-resolves-after-swap-seconds — the swap animation ends at
// SWAP_SECONDS, and step 1 resolves there.
//
// specs/rules.md gives the boundary in one sentence: "`swapTimer` holds `0`
// while `phase` is not `swapping`, and accumulates game time while it is. When
// `swapTimer` reaches `SWAP_SECONDS` it returns to `0`, `phase` becomes
// `resolving`, `chainStep` becomes `1`, and step `1` resolves."
//
// BOTH SIDES OF THE BOUNDARY ARE ONE POINT, because they are one sentence. A
// build that never leaves `swapping` leaves the player watching two gems travel
// for ever; a build that leaves it early throws the animation away and clears on
// the accepting frame. The two break the same rule from opposite directions, and
// a build that leaves it at the right moment plays the game — so the reading is
// taken twice, once just short of the boundary and once just past it.
//
// THE SCENARIO. Two rubies stand in row 4 at columns 2 and 4, and the third
// waits one row above the gap at (3,3), over the run-free filler; the swap drops
// it into (3,4) and the row carries three rubies across columns 2 to 4, bounded
// by a citrine and an amethyst the filler already holds, so the run is maximal
// at exactly three and R6 grows it by nothing — every gem on the board is plain
// at strain 0. The clear set is those three cells, which is what makes both
// readings decidable: before the boundary the whole board is the posed board
// with two tokens traded, and after it those three cells hold the gems that fell
// into them from the row above.
//
// WHAT THE CELLS HOLD AFTERWARDS IS THE ORACLE'S ANSWER, NOT A GUESS. R9 refills
// from the top of each column, and each of the three columns loses exactly one
// cell, so what lands in a run cell is the survivor from the row above it and
// never a refill — `board.ts`'s `settleBoard` says which gem that is for each of the
// three, and the check reads the KIND alone, because R7 raises the strain of the
// gems that were standing beside the clear set and that strain is R7's point
// rather than this one's.
//
// THE SCHEDULE STAYS CLEAR OF THE EXACT BOUNDARY FRAME, which "reaches" leaves
// open. `framesShortOf(SWAP_SECONDS)` is 11 frames, `0.171875` s, which sums to
// strictly less than `0.18` however a build compares; `framesPast` then adds the
// fewest frames that carry beyond `SWAP_SECONDS` with a whole frame to spare, so
// a `>=` build and a `>` build have both fired by the second reading. The
// overshoot is at most two frames, `0.03125` s, and the SHORTEST hold any step
// can have is `0.3` s, so the second reading is unambiguously inside step 1 and
// never inside a step after it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { MATCH_MIN, SWAP_SECONDS } from "../constants";
import {
  assertBoardEquals,
  clearSetFromRuns,
  maximalRuns,
  parseToken,
  quietRowsWith,
  renderCell,
  settleBoard,
  swapIsLegal,
  swapped,
  tokenAt,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  framesPast,
  framesShortOf,
  loadBoard,
  requestSwap,
  type Harness,
} from "../harness";

/** The ruby three the swap completes across row 4, every gem at strain 0. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 4, token: "R0" },
];

/** The swap that drops the waiting ruby into the gap. */
const SWAP_A: CellRef = { col: 3, row: 3 };
const SWAP_B: CellRef = { col: 3, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds through SWAP_SECONDS and resolves step 1 the moment it is spent", async () => {
  const posed = quietRowsWith(RUN_CELLS);
  const exchanged = swapped(posed, SWAP_A, SWAP_B);
  const cleared = clearSetFromRuns(exchanged);

  // The fixture, established before the build is asked anything: the posed board
  // rests under R4, R1 and R3 accept the swap, and the exchange leaves exactly
  // one maximal run of MATCH_MIN rubies, which R6 grows by nothing.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  const made = maximalRuns(exchanged);
  assertLength(made, 1, "maximal runs the exchange makes");
  assertLength(made[0].cells, MATCH_MIN, "cells in the run it makes");
  assertLength(cleared, MATCH_MIN, "cells the step's clear set holds");

  // What R9 leaves standing at each of those three cells: the survivor from the
  // row above, which the oracle names and the refill cannot reach.
  const settlement = settleBoard(exchanged, cleared);

  const before = loadBoard(h, posed);

  const readings = await captureReplay(h, "resolve", async () => {
    requestSwap(h, SWAP_A, SWAP_B);
    // The most frames that fit strictly inside SWAP_SECONDS.
    await h.advance(framesShortOf(SWAP_SECONDS));
    const inside = { snapshot: h.snapshot(), board: h.board() };
    // And the fewest that carry past it with a whole frame to spare.
    await h.advance(
      framesPast(Math.max(0, SWAP_SECONDS - inside.snapshot.swapTimer)),
    );
    return { inside, after: h.snapshot() };
  });

  // Short of the boundary: still in motion, still nothing cleared, and the board
  // still exactly the posed one with its two cells traded.
  assertEqual(
    readings.inside.snapshot.phase,
    "swapping",
    "the phase just short of SWAP_SECONDS",
  );
  assertEqual(
    readings.inside.snapshot.chainStep,
    0,
    "the chain step just short of SWAP_SECONDS",
  );
  assertEqual(
    readings.inside.snapshot.lastCleared,
    before.lastCleared,
    "cells reported cleared just short of SWAP_SECONDS",
  );
  assertBoardEquals(
    readings.inside.board,
    exchanged,
    "the board just short of SWAP_SECONDS",
  );

  // Past it: the swap is over, step 1 has opened, and the run's cells are gone —
  // each of the three holding the gem that fell into it from the row above.
  assertEqual(readings.after.phase, "resolving", "the phase past SWAP_SECONDS");
  assertEqual(readings.after.chainStep, 1, "the chain step past SWAP_SECONDS");
  assertEqual(
    readings.after.lastCleared,
    cleared.length,
    "cells the step removed",
  );
  for (const cell of cleared) {
    assertEqual(
      parseToken(renderCell(readings.after, cell.col, cell.row)).kind,
      parseToken(tokenAt(settlement.rows, cell.col, cell.row)).kind,
      `the kind standing at (${cell.col},${cell.row}) once the run was taken`,
    );
  }
});
