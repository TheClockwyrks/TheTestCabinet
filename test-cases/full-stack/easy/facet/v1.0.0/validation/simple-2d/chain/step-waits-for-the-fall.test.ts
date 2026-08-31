// chain/step-waits-for-the-fall — a step whose gems fell far holds longer than
// STEP_SECONDS.
//
// specs/rules.md hangs the hold off what the step itself did:
// `LAND_AT = SHATTER_END + lastFall * FALL_SECONDS_PER_ROW` (`0.05`), and
// `STEP_HOLD = LAND_AT + STEP_SECONDS` (`0.25`). `STEP_SECONDS` is the LAST of
// the three spans — "the board rests" — and never the whole of the hold, so a
// step whose survivors traveled several rows is still watching them travel at
// the moment a build holding a flat quarter-second would read the board again.
//
// THIS IS THE HALF `chain/chain-cadence` CANNOT SEE. That point reads the hold
// the build itself reports and requires the board to stand for exactly it, so a
// build that reports `STEP_SECONDS` for every step and honours its own figure
// passes it. What such a build gets wrong is that the figure must ANSWER to the
// fall, and that is what this point reads: the drive goes past `STEP_SECONDS`
// and requires the board to be exactly where the step left it, then past the
// step's own reported hold and requires the next step to have resolved.
//
// THE SCENARIO, AND THE ARITHMETIC THAT MAKES IT SAFE. A vertical run of three
// rubies at the FOOT of column 4 — rows 5, 6 and 7 — completed by trading the
// parked ruby at (5,6) into (4,6). Every survivor in that column falls three
// rows, and R9 refills rows 0, 1 and 2 from above the board, where a gem dealt
// into row `r` carries a `fell` of at least `r + 1`. So `lastFall` is at least
// `3` however a build deals its refill, and `lastWaves` is `0` because every gem
// is plain at strain 0 and the clear set is its seed alone. A conforming hold is
// therefore at least `3 x 0.05 + 0.25` = `0.40` s, a clear `0.15` s beyond the
// flat `STEP_SECONDS` a wrong build would use — which the check states as its
// own premise, against `board.ts`'s reading of R9.
//
// THE FIRST DRIVE IS SAFELY BETWEEN THE TWO. `swapAndStep` leaves the step a
// little under `0.04` s into its hold, and `framesPast` then carries past
// `STEP_SECONDS` with at most two frames of overshoot, landing near `0.28` s —
// past the flat quarter-second by a comfortable margin and far short of the
// `0.40` s a conforming build is holding for. Neither bound depends on how the
// build divided the swap's overrun, because both readings that follow are taken
// against the step's own reported timer and hold.
//
// THE CHAIN HAS A SECOND STEP TO RESOLVE INTO. The jade posed at (4,2) falls
// three rows into (4,5), between the jades already standing at (3,5) and (5,5),
// so the board step 1 settles into carries a maximal run of three across row 5 —
// made of survivors alone rather than of anything R9's seeded refill dealt. The
// check reads the settled board back and asserts it seeds a clear set before it
// waits for anything, so a scenario that stopped cascading is reported as that
// rather than as a build holding too long.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  assertTrue,
} from "../assert";
import { STEP_SECONDS } from "../constants";
import {
  assertBoardEquals,
  clearSetFromRuns,
  maximalRuns,
  quietRowsWithEscape,
  settle,
  stepHold,
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
  swapAndStep,
  type Harness,
} from "../harness";

/**
 * The cells written over the run-free filler.
 *
 * The first three make the vertical ruby run at the foot of column 4 once the
 * parked ruby trades in. The last three set up step 2: the jade at (4,2) falls
 * three rows into (4,5), between the jades at (3,5) and (5,5), so row 5 carries
 * a run of three the moment step 1 settles — out of survivors alone, so the
 * cascade does not depend on what the refill dealt.
 */
const CELLS: readonly PlacedToken[] = [
  { col: 4, row: 5, token: "R0" },
  { col: 4, row: 7, token: "R0" },
  { col: 5, row: 6, token: "R0" },
  { col: 4, row: 2, token: "J0" },
  { col: 3, row: 5, token: "J0" },
  { col: 5, row: 5, token: "J0" },
];

/** The swap that completes the run: the parked ruby trades into (4,6). */
const SWAP_A: CellRef = { col: 4, row: 6 };
const SWAP_B: CellRef = { col: 5, row: 6 };

/**
 * The rows the step's survivors and refills travel, at the least.
 *
 * Column 4 loses its bottom three cells, so every survivor above them falls
 * three rows and the three cells R9 refills come in from above row 0, 1 and 2 —
 * a `fell` of at least `1`, `2` and `3`. `board.ts`'s `settle` is what says so,
 * and the check reads it rather than taking this comment's word.
 */
const FALL_ROWS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds past STEP_SECONDS and resolves step 2 only at its own hold", async () => {
  const posed = quietRowsWithEscape(CELLS);
  const exchanged = swapped(posed, SWAP_A, SWAP_B);
  const cleared = clearSetFromRuns(exchanged);

  // The fixture: the posed board rests under R4, R1 and R3 accept the swap, and
  // the exchange leaves exactly one maximal run — the three at the foot of the
  // column, which R6 grows by nothing since every gem is plain at strain 0.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertLength(maximalRuns(exchanged), 1, "maximal runs the exchange makes");
  assertLength(cleared, 3, "cells the step's clear set holds");

  // And the arithmetic this point turns on, read off R9 rather than asserted by
  // hand: the step's fall is at least FALL_ROWS, so a conforming hold is longer
  // than the flat STEP_SECONDS a wrong build would use.
  const settlement = settle(exchanged, cleared);
  const fell =
    "exactly" in settlement.fall
      ? settlement.fall.exactly
      : settlement.fall.atLeast;
  assertGreaterThanOrEqual(fell, FALL_ROWS, "the rows R9's fall covers");
  assertGreaterThan(
    stepHold(0, FALL_ROWS),
    STEP_SECONDS,
    "the hold a conforming build owes this step, against a flat STEP_SECONDS",
  );

  loadBoard(h, posed);
  const first = await swapAndStep(h, SWAP_A, SWAP_B);
  assertEqual(first.chainStep, 1, "the chain step the swap resolved into");
  assertEqual(first.phase, "resolving", "the phase step 1 resolved in");

  // The board step 1 settled into really does seed a second step, so what is
  // waited for below exists. Read off the build's own board, since R9's refill
  // is the build's draw and the survivors' run is not.
  const held = h.board();
  assertGreaterThan(
    clearSetFromRuns(held).length,
    0,
    "the clear set the board step 1 settled into seeds",
  );

  const readings = await captureReplay(h, "wait", async () => {
    // Past STEP_SECONDS, and no further: `framesPast` overshoots by at most two
    // frames, so this lands near 0.28 s of the step's hold, well short of the
    // 0.40 s a conforming build is holding for.
    await h.advance(framesPast(Math.max(0, STEP_SECONDS - first.stepTimer)));
    const past = { snapshot: h.snapshot(), board: h.board() };
    // Then past the hold the step itself reported, which is where the next step
    // is due.
    await h.advance(
      framesPast(Math.max(0, past.snapshot.stepHold - past.snapshot.stepTimer)),
    );
    return { past, after: h.snapshot() };
  });

  // A quarter of a second of resolving is spent and the step is not over: the
  // chain has not moved on and not one cell has changed. A build holding a flat
  // STEP_SECONDS has already read the board again and fails here.
  assertEqual(
    readings.past.snapshot.chainStep,
    1,
    "the chain step once STEP_SECONDS of the step is spent",
  );
  assertEqual(
    readings.past.snapshot.phase,
    "resolving",
    "the phase once STEP_SECONDS of the step is spent",
  );
  assertBoardEquals(
    readings.past.board,
    held,
    "the board once STEP_SECONDS of the step is spent",
  );
  assertGreaterThan(
    readings.past.snapshot.stepTimer,
    STEP_SECONDS,
    "the step's own timer, which the drive carried past STEP_SECONDS",
  );

  // And past the hold the step named, the next step resolved.
  assertEqual(
    readings.after.chainStep,
    2,
    "the chain step once the step's own hold is spent",
  );
  assertEqual(
    readings.after.phase,
    "resolving",
    "the phase once the step's own hold is spent",
  );
});
