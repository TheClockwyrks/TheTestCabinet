// cuts/r8-prism-swap-creates-nothing — a step seeded from a prism swap creates no
// cut gem at all, however much of the board it clears.
//
// specs/rules.md, the sentence R8 opens with: "R8 reads the maximal runs that
// SEEDED the step under R5. A step seeded from a `prism` swap has none of those,
// and creates nothing."
//
// THE DEFECT THIS IS AIMED AT. R8's table is easy to read as a rule about the
// board — look for lines of four, of five, and for crossings, and mint a gem for
// each. That reading is wrong, and it is invisible on an ordinary step, where the
// runs on the board and the runs that seeded the step are the same set. It becomes
// visible only when the two differ, which is exactly what R5's prism seed does: a
// prism traded against a gem seeds the step with "that `prism` together with every
// gem on the board of that gem's kind", and the maximal runs standing on the board
// seed nothing.
//
// So the posed board carries two runs that would each mint a gem under the wrong
// reading — five rubies across row 4, which R8's table would make a prism, and
// four jades across row 6, which it would make a brilliant — and the chain is
// opened by trading the prism at (0,3) against the ruby beside it. Fifteen cells
// clear (the prism and all fourteen rubies, the row of five among them), the row
// of jades is untouched, and a conforming build creates nothing whatever.
//
// WHY THE READING IS TAKEN AT STEP 1 AND NOT ON THE SETTLED BOARD. Only step 1 of
// this chain is prism-seeded; specs/rules.md seeds "every step after step `1` of
// either chain ... from the maximal runs", so a second step is an ordinary step
// and is fully entitled to create cuts of its own. The settled board would answer
// a different question, and answer it out of the build's random refill.
//
// WHICH READING IS STEP 1'S. specs/rules.md has an accepted swap exchange its two
// cells at once, set `phase` to `swapping` with `chainStep` at `0`, and clear
// nothing until `SWAP_SECONDS` (`0.18`) of game time has passed; step 1 then
// resolves, R8 and R9 both inside it. `swapAndResolve` carries the game through
// that animation and hands back `first`, the reading of step 1's result, which is
// what this check reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
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
  swapAndResolve,
  type Harness,
} from "../harness";
import type { CellSnapshot, FacetSnapshot } from "../surface";

/** The fewest gems this scenario's prism clear is required to take. */
const CLEAR_FLOOR = 8;

/**
 * The cells written over the quiet filler.
 *
 * A prism at (0,3), beside the ruby at (1,3) it is traded against. Rubies at
 * (2,4) to (5,4) join the one the filler already holds at (6,4) to make a maximal
 * run of five across row 4, bounded by a citrine and an amber. Jades at (3,6),
 * (4,6) and (6,6) join the one at (5,6) to make a maximal run of four across row
 * 6, bounded by a ruby and a sapphire — a run of a kind the prism swap does not
 * clear, left standing to be minted from by a build that reads R8 off the board.
 */
const CELLS: readonly PlacedToken[] = [
  { col: 0, row: 3, token: "X0" },
  { col: 2, row: 4, token: "R0" },
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "R0" },
  { col: 3, row: 6, token: "J0" },
  { col: 4, row: 6, token: "J0" },
  { col: 6, row: 6, token: "J0" },
];

/** The swap that opens the chain: the prism trades against the ruby beside it. */
const FROM: CellRef = { col: 0, row: 3 };
const TO: CellRef = { col: 1, row: 3 };

/** Every gem a reading reports carrying `cut`. */
function withCut(snapshot: FacetSnapshot, cut: string): CellSnapshot[] {
  return snapshot.board.cells.filter((cell) => cell.cut === cut);
}

/** Every gem a reading reports that is not `plain`. */
function cutCells(snapshot: FacetSnapshot): CellSnapshot[] {
  return snapshot.board.cells.filter((cell) => cell.cut !== "plain");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates no brilliant, star or prism from a prism-seeded step", async () => {
  const posed = quietRowsWith(CELLS);

  // The scenario, established before the build is asked anything. One of the two
  // cells the swap names holds a prism and the other does not, so R5's first prism
  // seed is the one this chain opens with. And the board really does carry the two
  // runs a wrong reading of R8 would mint from: one of five, one of four.
  assertEqual(isPrism(posed, FROM), true, "whether the swap moves a prism");
  assertEqual(isPrism(posed, TO), false, "whether it is traded against a gem");
  const standing = maximalRuns(posed)
    .map((run) => run.cells.length)
    .sort((a, b) => a - b);
  assertEqual(
    standing.join(","),
    "4,5",
    "the lengths of the maximal runs standing on the posed board",
  );

  const before = await loadBoard(h, posed);
  assertLength(withCut(before, "prism"), 1, "prisms on the posed board");
  assertLength(cutCells(before), 1, "cut gems on the posed board");

  const { first } = await captureReplay(h, "clear", () =>
    swapAndResolve(h, FROM, TO),
  );

  // The step really was the large clear the item asks for, so a build is being held
  // to R8 over a step that cleared plenty rather than over a trivial one.
  assertEqual(first.chainStep, 1, "the chain step the accepted swap resolved");
  assertGreaterThanOrEqual(
    first.lastCleared,
    CLEAR_FLOOR,
    "cells the prism-seeded step cleared",
  );

  // Neither length row of R8's table fired. The board carried a run of five and a
  // run of four, and neither seeded the step, so neither mints anything — this half
  // rests on R8 alone, since the posed board carried no brilliant and no star for
  // one to be confused with.
  assertLength(withCut(first, "brilliant"), 0, "brilliants the step created");
  assertLength(withCut(first, "star"), 0, "stars the step created");

  // And no prism either. R5 puts the traded prism itself in the seed, so it is
  // removed with the rest of the clear set and R9 refills its cell `plain` at
  // strain 0 — leaving a board with no cut gem anywhere unless the step minted one.
  assertLength(cutCells(first), 0, "cut gems standing after the step");
});
