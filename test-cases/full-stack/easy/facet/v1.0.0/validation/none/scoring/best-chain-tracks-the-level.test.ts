// Facet — scoring/best-chain-tracks-the-level: every step sets `bestChain` to the
// greater of itself and the step that just resolved.
//
// specs/rules.md, the third row of the table of figures a level is measured by:
// "`bestChain` — The deepest `chainStep` any chain has reached in the current
// level, and `0` until a chain has run. Each step sets it to the greater of
// itself and `chainStep`." Two things are being claimed at once, and a build can
// hold either without the other: the figure is a MAXIMUM, so a build that assigns
// `chainStep` to it reports the last chain's depth rather than the level's
// deepest and loses a seven-step cascade to the next three-in-a-row; and it is
// taken at EVERY step, so a build that takes it only where a chain ends reports
// nothing at all for a chain still running, which is exactly when the player is
// watching it.
//
// BOTH DIRECTIONS, FROM ONE POSED FIGURE. The same two-step chain is driven twice
// from the same posed board. The first time `bestChain` is posed through
// `setBestChain` deeper than the chain can reach, so the standing figure is the
// greater at both steps and must come through untouched. The second time it is
// posed at `0`, so each step's own number is the greater and the figure must
// climb to 1 and then to 2. Posing the standing figure is what supplies the
// "greater of" half without needing a chain deeper than one a board can be posed
// to produce — `chainStep` itself is not writable, and every step past the first
// depends on R9's refill.
//
// THE FIGURE IS READ AT EACH STEP, not only at the end, because the rule has
// every step take it. The chain is therefore driven one boundary at a time —
// `swapAndStep` through the swap animation into step 1, then `advanceStep` past
// that step's own reported `stepHold` into step 2 — and the figure is read out of
// each step's own snapshot.
//
// AND THE DRIVE STOPS AT STEP 2 ON PURPOSE. The board is arranged to cascade
// exactly that far out of its own survivors; anything past it would be seeded by
// whatever R9's generator dealt into the top of the column, which is the build's
// business and no part of this point. Stopping at the second boundary is what
// makes "reaches exactly 2" a statement about the arrangement rather than about
// the deal.
//
// THE SCENARIO. Three rubies in column 3 are cleared by the swap, and the two
// jades above them fall onto the jade below to make a column of three on the
// board the next read finds. All three cells of that second run are SURVIVORS of
// the first step rather than refills, so the second step happens whatever the
// build dealt. The spare legal swap in the bottom-left corner keeps the round
// alive, and the scenario's own cells stay inside column 3, clear of that corner.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
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

/** How deep the arrangement cascades out of its own survivors. */
const CASCADE_DEPTH = 2;

/**
 * The standing figure the losing direction is posed with: deeper than the chain
 * this board reaches, so the maximum is settled by the standing figure at both
 * readings rather than by only one of them.
 */
const POSED_DEEP = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Drive the posed chain one step boundary at a time, keeping the reading each
 * step left.
 *
 * `swapAndStep` carries the board through the swap animation to step 1's result,
 * and `advanceStep` past exactly one boundary — the step's own `stepHold`, read
 * off the snapshot, less the `stepTimer` already spent — into step 2. Nothing
 * here counts frames of its own, because a step's hold is the step's own figure.
 */
async function driveTwoSteps(): Promise<FacetSnapshot[]> {
  const first = await swapAndStep(h, SWAP_A, SWAP_B);
  const second = await advanceStep(h);
  return [first, second];
}

/**
 * Every reading of a drive held to the rule: at chain step `n`, the figure is the
 * greater of what stood before the chain began and `n`.
 */
function assertTakesTheGreater(
  readings: readonly FacetSnapshot[],
  standing: number,
  when: string,
): void {
  for (let index = 0; index < readings.length; index += 1) {
    const step = index + 1;
    const reading = readings[index];
    assertEqual(
      reading.chainStep,
      step,
      `${when}: the chain step the ${step}${step === 1 ? "st" : "nd"} boundary resolved`,
    );
    assertEqual(
      reading.bestChain,
      Math.max(standing, step),
      `${when}: the longest chain at step ${step}, against the greater of the ` +
        `standing ${standing} and that step`,
    );
  }
}

it("raises the level's longest chain to the deepest step, and no lower", async () => {
  const posed = quietRowsWithEscape(CHAIN_CELLS);
  // The fixture's own guarantees: the posed board carries no run of its own, the
  // swap is one R1 and R3 both accept, the only run it makes is the first step's,
  // and the figure posed over the losing direction really is deeper than the
  // chain this board reaches.
  assertEqual(maximalRuns(posed).length, 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertEqual(
    maximalRuns(swapped(posed, SWAP_A, SWAP_B)).length,
    1,
    "maximal runs the swap makes",
  );
  assertGreaterThan(
    POSED_DEEP,
    CASCADE_DEPTH,
    "the posed standing figure, against the depth this chain reaches",
  );

  // The losing direction: a standing figure no step of this chain can beat.
  await loadBoard(h, posed);
  await h.debug.setBestChain(POSED_DEEP);
  assertEqual(
    (await h.snapshot()).bestChain,
    POSED_DEEP,
    "the standing longest chain the drive opens on",
  );
  const under = await driveTwoSteps();
  assertTakesTheGreater(under, POSED_DEEP, "under a deeper standing figure");

  // The winning direction: the same chain with nothing standing over it, so each
  // step's own number is the greater and the figure climbs with it.
  await loadBoard(h, posed);
  await h.debug.setBestChain(0);
  assertEqual(
    (await h.snapshot()).bestChain,
    0,
    "the standing longest chain the second drive opens on",
  );
  const raised = await captureReplay(h, "best", () => driveTwoSteps());
  assertTakesTheGreater(raised, 0, "over a standing 0");

  // And the chain really did reach the depth the point is stated over, so the
  // readings above are of a two-step chain rather than of a step repeated.
  assertEqual(
    raised[raised.length - 1].chainStep,
    CASCADE_DEPTH,
    "the depth the chain reached",
  );
  assertEqual(
    raised[raised.length - 1].bestChain,
    CASCADE_DEPTH,
    "the longest chain the level ends the drive holding",
  );
});
