// Facet — moves/r1-adjacent-accepted: R1 accepts an orthogonally adjacent swap.
//
// R1 in specs/rules.md names TWO shapes an exchange may take, and both are a
// move: the two cells "differ by 1 in column and 0 in row, or by 0 in column and
// 1 in row". Both are posed here rather than one, because a build that wired
// only one axis — a drag reader that answers a sideways gesture and drops an
// upright one, a release that only ever trades with the cell to the right —
// passes a check that poses a single orientation while half of every board is
// unplayable.
//
// WHAT ACCEPTANCE LOOKS LIKE, AND WHY IT IS READ IN TWO PLACES. specs/rules.md
// puts an animation between the acceptance and the first step: an accepted swap
// "exchanges the two cells at once, sets `phase` to `swapping`, sets `swapTimer`
// to `0`, and leaves `chainStep` at `0`. Nothing is cleared yet". So the request
// is read with NO frame advanced, where the acceptance shows as `swapping` with
// nothing refused and the two cells already exchanged; and then the game is
// carried past `SWAP_SECONDS` (`0.18`), where the acceptance shows as
// `resolving` at `chainStep` 1. A build that refused the request never reaches
// either reading, and a build that took it and cleared on the spot fails the
// first.
//
// THE WHOLE BOARD IS READ AT THE FIRST READING, AND IT CAN BE. Nothing has been
// cleared yet, so the board the request left is the posed board with exactly two
// cells exchanged — which `board.ts`'s `swapped` states independently. That is a
// stronger reading than the two named cells: a build that exchanged the pair and
// also disturbed something else is caught by it.
//
// WHAT IS DELIBERATELY NOT READ. What the step then CLEARS, which is `runs`'s,
// and how long the swap holds before it resolves, which is `chain`'s two swap
// points. What this one reads is only that the acceptance path was opened at all,
// on both of R1's admissible offsets.
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
  assertBoardEquals,
  maximalRuns,
  quietRowsWith,
  swapWouldMatch,
  swapped,
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

afterEach(() => {
  h.dispose();
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

/** What specs/rules.md says the frame that ACCEPTS a swap has left behind. */
function assertInMotion(taken: FacetSnapshot, context: string): void {
  assertEqual(taken.phase, "swapping", `${context}: phase`);
  assertEqual(taken.chainStep, 0, `${context}: chainStep`);
  assertNull(taken.refusal, `${context}: refusal`);
}

/** What specs/rules.md says stands once `SWAP_SECONDS` has gone by. */
function assertResolved(landed: FacetSnapshot, context: string): void {
  assertEqual(landed.phase, "resolving", `${context}: phase`);
  assertEqual(landed.chainStep, 1, `${context}: chainStep`);
}

/**
 * Pose `rows`, request `pair`, and hold the two readings R1's acceptance shows
 * itself in.
 *
 * `advanceStep` carries a `swapping` board past `SWAP_SECONDS` and stops well
 * inside the step that follows, reading the frames it needs off the state rather
 * than off a constant, so neither reading depends on a figure written here.
 */
async function acceptsAndResolves(
  rows: BoardRows,
  pair: Pair,
  context: string,
): Promise<void> {
  assertFixture(rows, pair, context);
  loadBoard(h, rows);

  const inMotion = requestSwap(h, pair.a, pair.b);
  assertInMotion(inMotion, context);
  // The exchange happened "at once", and nothing else did: the board the request
  // left is the posed board with exactly those two cells traded.
  assertBoardEquals(
    h.board(),
    swapped(rows, pair.a, pair.b),
    `${context}: the board the acceptance left`,
  );

  assertResolved(await advanceStep(h), `${context}, ${SWAP_SECONDS}s later`);
}

it("accepts an exchange one column apart", async () => {
  // The capture brackets the request and the animation that follows it, so the
  // evidence a reviewer opens is the board taking the move rather than a still
  // picture of the moment before it.
  await captureReplay(h, "swap", () =>
    acceptsAndResolves(SIDEWAYS_ROWS, SIDEWAYS, "the sideways exchange"),
  );
});

it("accepts an exchange one row apart", async () => {
  // The same rule on the other axis. A build that accepts only one of the two
  // orientations reaches this check having passed the one above it.
  await acceptsAndResolves(UPRIGHT_ROWS, UPRIGHT, "the upright exchange");
});
