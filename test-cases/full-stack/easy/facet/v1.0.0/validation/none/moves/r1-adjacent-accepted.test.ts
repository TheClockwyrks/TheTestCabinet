// Facet — moves/r1-adjacent-accepted: R1 accepts an orthogonally adjacent swap.
//
// R1 in specs/rules.md names TWO shapes an exchange may take, and both are a
// move: the two cells "differ by 1 in column and 0 in row, or by 0 in column and
// 1 in row". Both are posed here rather than one, because a build that wired
// only one axis — a drag reader that answers a sideways gesture and drops an
// upright one, a keyboard commit that only ever trades with the cell to the
// right — passes a check that poses a single orientation while half of every
// board is unplayable.
//
// WHAT ACCEPTANCE LOOKS LIKE, AND WHY IT IS READ THIS WAY. "A chain step" says
// an accepted swap "exchanges the two cells at once, sets chainStep to 1, sets
// phase to resolving, and resolves step 1 immediately". So the reading is taken
// with NO frame advanced, and what it shows is phase `resolving` at chainStep 1
// with nothing refused. The two exchanged cells are deliberately not read back:
// step 1 has already cleared the run they made and R9 has refilled over it, so
// they no longer hold what was exchanged. That is the ruleset working, not a
// fault, and it is why acceptance is read off the phase rather than off the
// board.
//
// WHY THE READING IS ABOUT R1 AND NOTHING ELSE. Each board is the run-free
// filler with exactly the cells its scenario needs written over it, and the
// fixture assertions prove of each that it carries no maximal run of its own and
// that the exchange makes one. R2 is satisfied because a posed board rests
// `idle`, and R3 is satisfied because the exchange is productive — so R1 is the
// only rule left with anything to say about the request.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull, assertTrue } from "../assert";
import {
  areAdjacent,
  maximalRuns,
  quietRowsWith,
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
import type { FacetSnapshot } from "../surface";

/** One requested exchange, named as R1 names its two cells. */
interface Pair {
  a: CellRef;
  b: CellRef;
}

/**
 * A board whose only move trades SIDEWAYS: `(4,3)` with `(5,3)`, one column
 * apart and on one row.
 *
 * The filler already holds a jade at `(4,3)`, and the scenario writes jades
 * above and below the cell it is traded into, so the exchange completes column 5
 * over rows 2, 3 and 4 — a maximal run of exactly three.
 */
const SIDEWAYS_ROWS: BoardRows = quietRowsWith([
  { col: 5, row: 2, token: "J0" },
  { col: 5, row: 4, token: "J0" },
]);

/** The sideways pair: `1` in column, `0` in row. */
const SIDEWAYS: Pair = { a: { col: 4, row: 3 }, b: { col: 5, row: 3 } };

/**
 * A board whose only move trades UPRIGHT: `(3,3)` with `(3,4)`, one row apart
 * and in one column.
 *
 * Two rubies flank the gap at `(3,4)` and a third waits directly above it, so
 * the exchange completes row 4 over columns 2, 3 and 4.
 */
const UPRIGHT_ROWS: BoardRows = quietRowsWith([
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
]);

/** The upright pair: `0` in column, `1` in row. */
const UPRIGHT: Pair = { a: { col: 3, row: 3 }, b: { col: 3, row: 4 } };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The world each scenario claims to be posing, proved before the build is asked
 * anything.
 *
 * All three matter. Without adjacency the request is not R1's to accept; with a
 * run already standing the board is not the settled world R2 needs; and without
 * a productive exchange R3 would refuse the request whatever R1 said. A fixture
 * that quietly lost one of the three would turn a green check into a lie.
 */
function assertFixture(rows: BoardRows, pair: Pair, context: string): void {
  assertTrue(
    areAdjacent(pair.a, pair.b),
    `${context}: the pair is orthogonally adjacent`,
  );
  assertLength(maximalRuns(rows), 0, `${context}: runs on the posed board`);
  assertTrue(
    swapWouldMatch(rows, pair.a, pair.b),
    `${context}: the exchange makes a maximal run`,
  );
}

/** What specs/rules.md says an accepted swap has left behind. */
function assertAccepted(taken: FacetSnapshot, context: string): void {
  assertEqual(taken.phase, "resolving", `${context}: phase`);
  assertEqual(taken.chainStep, 1, `${context}: chainStep`);
  assertNull(taken.refusal, `${context}: refusal`);
}

it("accepts an exchange one column apart", async () => {
  assertFixture(SIDEWAYS_ROWS, SIDEWAYS, "the sideways exchange");
  await loadBoard(h, SIDEWAYS_ROWS);

  // The capture brackets the request and one step's worth of frames after it, so
  // the evidence a reviewer opens is the board taking the move rather than a
  // still picture of the moment before it.
  const taken = await captureReplay(h, "swap", async () => {
    const reading = await swap(h, SIDEWAYS.a, SIDEWAYS.b);
    await h.advance(FRAMES_PER_STEP);
    return reading;
  });

  assertAccepted(taken, "the sideways exchange");
});

it("accepts an exchange one row apart", async () => {
  // The same rule on the other axis. A build that accepts only one of the two
  // orientations reaches this check having passed the one above it.
  assertFixture(UPRIGHT_ROWS, UPRIGHT, "the upright exchange");
  await loadBoard(h, UPRIGHT_ROWS);

  const taken = await swap(h, UPRIGHT.a, UPRIGHT.b);

  assertAccepted(taken, "the upright exchange");
});
