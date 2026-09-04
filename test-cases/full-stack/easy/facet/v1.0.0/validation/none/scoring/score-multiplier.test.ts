// Facet — scoring/score-multiplier: a step's points are its clear set's points
// times `M = min(chainStep, MAX_MULTIPLIER)`.
//
// specs/rules.md gives the multiplier once, and every figure in the scoring table
// is stated against it. Step 1 pays the bare rates, and this point is the claim
// that step 2 pays them doubled — the whole reason a chain is worth building.
// `MAX_MULTIPLIER` (8) is far above 2, so nothing here is clamped and the
// multiplier is `chainStep` itself.
//
// THE SCENARIO IS A REAL CASCADE, NOT A POSED STEP. A chain step's number cannot
// be posed: the surface carries no `setChainStep`, and it should not, because
// what is under test is the game deciding that this board is the SECOND step of a
// chain. So the board is arranged for step 2 to happen on its own: three rubies
// in column 3 are cleared by the swap, and the two jades sitting above them fall
// onto the jade below, which is a run the next board read finds.
//
// WHY THE EXPECTATION IS A RATIO AND NOT A SUM OF RATES. What one cleared gem is
// worth is `scoring/score-base-rate`'s claim and `scoring/score-flawed-rate`'s.
// An expectation of `2 x (the rates over step 2's set)` would fail this point for
// a build that doubled step 2 exactly as the specification says and priced a gem
// wrongly — charging one build two points for one fault. So the two steps are
// compared with EACH OTHER: both clear sets are read off the boards the steps
// actually scored, both are made of gems below MAX_STRAIN so one rate covers
// every cell in either, and the requirement is that step 2 paid twice per cell
// what step 1 paid per cell. Whatever that rate is, the doubling is decided here
// and the rate is decided elsewhere.
//
// THAT BOTH SETS ARE UNFLAWED IS THE RULES' DOING, NOT AN ASSUMPTION. The posed
// board stands entirely at strain 0; R7 raises a survivor by one and R9 refills
// at strain 0, so nothing the first step leaves behind can be at MAX_STRAIN. The
// check reads the strains rather than trusting the argument, and a board that
// somehow carried a flawed gem into step 2 fails here as the scenario it is.
//
// WHY THE SECOND SET IS READ OFF THE BOARD THAT WAS OBSERVED. R9 refills from the
// game's own seeded generator, so what lands in the emptied cells is the build's
// business and no check may predict it. But the board step 1 LEFT is exactly the
// board step 2 reads and scores, and it is readable: the check reads it back as
// notation and computes step 2's clear set over it by R4, R5 and R6 as `board.ts`
// restates them. So a build whose refill differed is held to its own board rather
// than to this one's.
//
// HOW THE TWO STEPS ARE REACHED. An accepted swap exchanges the two cells at
// once, sets `phase` to `swapping` with `chainStep` at `0`, and clears nothing;
// step 1 resolves once `SWAP_SECONDS` (`0.18`) of game time has passed.
// `swapAndStep` carries the board through that animation to step 1's result, and
// `advanceStep` then carries it past exactly one step boundary — the step's own
// `stepHold`, read off the snapshot, less the `stepTimer` already spent — into
// step 2.
//
// WHAT IS READ, AND WHERE. `score` either side of each step, since specs/rules.md
// is about what a step ADDS. `lastPoints` is not read: what that field reports of
// a step is `scoring/last-step-reported`'s claim.
//
// A build that ran the doubling on step 1, or that never doubled at all, fails on
// the points; a build that counts a fresh chain rather than a second step fails on
// `multiplier`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { MAX_MULTIPLIER, MAX_STRAIN } from "../constants";
import {
  clearSetFromRuns,
  maximalRuns,
  quietRowsWith,
  strainAt,
  swapped,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  advanceStep,
  captureReplay,
  createHarness,
  framesShortOf,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/**
 * A ruby three in column 3 that the swap completes, with jades above and below it
 * arranged so that R9's settling of the emptied cells lands three jades in a
 * column and gives the next board read a run of its own.
 *
 * The jade at `(3,5)` sits under the run and does not move; the two above fall
 * onto it. Nothing here is three of a kind before the swap. All three cells of
 * the run step 2 clears are SURVIVORS of step 1 rather than refills, so the
 * second step happens whatever the build's generator dealt into the top of the
 * column.
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

/** The step this point is about. */
const SECOND_STEP = 2;

/**
 * Frames that carry the recording to just short of the end of the step the
 * reading was taken in.
 *
 * A step's hold is the step's OWN figure — `lastWaves * WAVE_SECONDS` plus
 * `lastFall * FALL_SECONDS_PER_ROW` plus `STEP_SECONDS`, which the snapshot
 * reports as `stepHold` — so the frames that fill it are read off the snapshot
 * rather than written down. `framesShortOf` keeps the drive strictly inside what
 * is left of the hold, so the recording ends on step 2's own clear rather than on
 * whatever a third step would make of it.
 */
function restOfStep(reading: FacetSnapshot): number {
  return framesShortOf(Math.max(0, reading.stepHold - reading.stepTimer));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Every one of `cells` carries a strain below MAX_STRAIN on the written board.
 *
 * What makes a step's points proportional to the cells it took: the scoring table
 * pays one rate across that whole band, so a set with no flawed gem in it is a
 * set of cells that were all paid alike.
 */
function requireUnflawed(
  rows: BoardRows,
  cells: readonly CellRef[],
  what: string,
): void {
  for (const cell of cells) {
    assertLessThan(
      strainAt(rows, cell.col, cell.row),
      MAX_STRAIN,
      `strain at (${cell.col},${cell.row}), ${what}`,
    );
  }
}

it("pays a second chain step twice its clear set's rates", async () => {
  const posed = quietRowsWith(CHAIN_CELLS);
  const opening = swapped(posed, SWAP_A, SWAP_B);
  const openingCleared = clearSetFromRuns(opening);

  // The fixture. The posed board carries no run, so the chain is the swap's
  // alone, and the swap produces exactly one — step 1 is a plain three, every gem
  // of it below MAX_STRAIN.
  assertEqual(maximalRuns(posed).length, 0, "maximal runs on the posed board");
  assertEqual(maximalRuns(opening).length, 1, "maximal runs the swap produces");
  assertEqual(openingCleared.length, 3, "cells step 1 clears");
  requireUnflawed(
    opening,
    openingCleared,
    "which must be below MAX_STRAIN for step 1's cells to be paid alike",
  );
  // The step under test is inside the range the multiplier is `chainStep` itself,
  // so nothing here is testing the clamp.
  assertLessThan(SECOND_STEP, MAX_MULTIPLIER, "the step under test");

  await loadBoard(h, posed);

  const chain = await captureReplay(h, "chain", async () => {
    // One frame of the board as it stands, so the replay opens on the column the
    // swap is about to clear.
    await h.advance(1);
    // The standing score, read on the settled board the swap is about to be made
    // on. What each step paid is what it moves this figure by.
    const before = await h.snapshot();
    const first = await swapAndStep(h, SWAP_A, SWAP_B);
    // The board step 1 LEFT, refill and all. This is what the next board read
    // will see, so step 2's clear set and the strain each of its gems carries are
    // both decidable here, before the build has scored anything for them.
    const between = await h.board();
    const second = await advanceStep(h);
    const measured = { before, first, between, second };
    await h.advance(restOfStep(second));
    return measured;
  });

  assertEqual(
    chain.first.chainStep,
    1,
    "the chain step the accepted swap opened",
  );

  const laterCleared = clearSetFromRuns(chain.between);
  // Step 2 has to exist for the point to mean anything: a board step 1 left with
  // no run would end the chain instead, and the scenario would be reporting on
  // nothing.
  assertGreaterThan(
    laterCleared.length,
    0,
    "cells the board left by step 1 clears",
  );
  requireUnflawed(
    chain.between,
    laterCleared,
    "which the rules leave below MAX_STRAIN on a board opened at strain 0",
  );

  assertEqual(
    chain.second.chainStep,
    SECOND_STEP,
    "the chain step that resolved",
  );
  assertEqual(
    chain.second.multiplier,
    SECOND_STEP,
    `min(chainStep, MAX_MULTIPLIER) at chain step ${SECOND_STEP}`,
  );

  const firstBanked = chain.first.score - chain.before.score;
  const secondBanked = chain.second.score - chain.first.score;

  // Step 1 was paid something. Without this the relation below would hold over
  // two steps that banked nothing at all.
  assertGreaterThan(firstBanked, 0, "the points step 1 banked");
  // Cross-multiplied so the comparison stays in whole numbers: step 2's points
  // per cell, against twice step 1's points per cell.
  assertEqual(
    secondBanked * openingCleared.length,
    SECOND_STEP * firstBanked * laterCleared.length,
    `step 2's ${laterCleared.length} cleared cells paid at ${SECOND_STEP} times ` +
      `the rate step 1 paid over its ${openingCleared.length}`,
  );
});
