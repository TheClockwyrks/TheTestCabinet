// Facet — instrumentation/delta-time-independent: one interval of game time
// reaches the same place however it is divided into frames.
//
// WHY THIS IS A POINT. specs/overview.md states the rule the whole simulation is
// written under — "Every rate in this specification is per second and every
// duration is in seconds, integrated against the delta time the runtime hands
// each update" — and specs/instrumentation.md turns it into the property the
// automation surface rests on: game state "advances from the elapsed game time
// the game is handed ... so an interval of game time carries the game to the
// same place however it was divided into frames", and, of the clock operation
// itself, "`advance(1, 1)` and `advance(1, 60)` cover the same second of game
// time and must reach the same outcome". A build that counts FRAMES instead — a
// chain step every frame, or a swap that lands after a fixed number of them,
// rather than after the game time specs/rules.md gives each — plays correctly on
// the machine it was written on and runs at half speed on a 30 Hz display, at
// double on a 120 Hz one. Nothing else in this project would catch that: every
// other check drives at one fixed rate, where a frame count and an elapsed time
// are the same statement.
//
// TWO TIMERS, AND THE INTERVAL CROSSES BOTH. specs/rules.md gives a move two
// spans in succession: `swapTimer` runs to `SWAP_SECONDS` (`0.18`) while the two
// gems are in motion, and then `stepTimer` runs to the resolving step's own
// `stepHold`. They are integrated separately, and a build can carry one against
// elapsed time and the other against frames, so the interval below is sized to
// carry both boundaries under either division.
//
// WHAT EACH DRIVE IS HELD TO. Not to the other drive: two drives are each held
// to the place specs/rules.md puts the move at the end of the interval. Past
// `SWAP_SECONDS` and past step 1's own hold, the board has been read again and
// step 2 has resolved, so `phase` is `resolving` and `chainStep` is `2`; step 1
// cleared three plain rubies at multiplier 1 and step 2 three jades at
// multiplier 2, so `score` is `3 * BASE_SCORE + 3 * BASE_SCORE * 2`; and the
// board is the one R9 leaves after those two steps. A build integrating game
// time reaches all of that from one frame exactly as it does from sixty, and a
// build counting frames reaches step 2 from the sixty and not from the one.
//
// WHY THE REFILL IS POSED. R9 draws a refill's kind at random, and a drawn gem
// could complete a run of its own and put a step on the board that the rules
// over the posed board do not account for. The refill is therefore posed through
// `setRefillKinds` on every column the two steps empty, with kinds that complete
// no run, so the board at the end of the interval is the rules' alone and can be
// stated. The kinds' strain is R7's point rather than this one's, so the board is
// compared kind by kind and the strain digits are left to `strain`.
//
// THE CASCADE, AND WHY ITS SECOND STEP IS NOT POSED. Step 2 is made by R9's
// settling of step 1, so a build cannot reach it by reading the posed board —
// it has to have run a settling. specs/rules.md governs it, and the posed board
// carries no run at all:
//
//   1. The swap carries the ruby at (5,2) down into (5,3), completing the
//      rubies at (3,3) and (4,3) across row 3. R3 accepts it, and step 1
//      resolves once the swap animation has run.
//   2. Column 4 holds jades at rows 2, 4 and 5 — no run while the ruby at (4,3)
//      parts them. Step 1 removes that ruby, the jade at (4,2) falls into (4,3),
//      and the three jades are a maximal run down column 4.
//
// So the interval ends INSIDE a chain, which is where a build that resolved its
// steps a frame apart and one that resolved them a hold apart part.
//
// THE INTERVAL, AND WHY IT IS MEASURED RATHER THAN WRITTEN DOWN. A step's hold is
// the STEP's own figure — `lastWaves * WAVE_SECONDS + lastFall *
// FALL_SECONDS_PER_ROW + STEP_SECONDS` — and `lastFall` is a figure the
// specification leaves partly to the build, since a refilled gem's `fell` is
// fixed only as a floor. So there is no constant that is guaranteed to land
// between step 1's boundary and step 2's for every conformant build, and an
// interval that landed ON a boundary would be reading a coin toss rather than a
// rule.
//
// The interval is therefore taken off the build itself. The scenario is posed
// once, carried past the swap animation into step 1, and that step's own
// `stepHold` is read; the interval is
//
//   SWAP_SECONDS + stepHold(step 1) + BOUNDARY_MARGIN
//
// which is step 1's boundary plus a margin. `BOUNDARY_MARGIN` is half of
// `STEP_SECONDS`, `0.125` s, and the SHORTEST hold any step can have is `0.3` s
// (`lastWaves` is `0` when the clear set is its seed alone, and `lastFall` is at
// least `1` because a step that cleared anything refills at least one cell from
// above row `0`). So the interval lands `0.125` s past step 1's boundary and at
// least `0.175` s short of step 2's, whatever figures the two steps turned out to
// carry. Both divisions therefore cross exactly the same two boundaries, and
// neither is decided by floating-point residue near one of them.
//
// WHAT IS COMPARED, AND WHAT IS NOT. The board's kinds, the chain step, the
// phase, the score and the simulation clock. `swapTimer` and `stepTimer` are
// deliberately left out: specs/rules.md says each returns to `0` when it reaches
// its span and says nothing about what becomes of the overrun, so two compliant
// builds legitimately hold different remainders just past a boundary.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
  clearSetFromRuns,
  maximalRuns,
  quietRowsWithEscape,
  renderBoard,
  settleBoard,
  swapIsLegal,
  swapped,
  WILDCARD,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  BASE_SCORE,
  GRID_COLS,
  STEP_SECONDS,
  SWAP_SECONDS,
} from "../constants";
import {
  advanceStep,
  captureReplay,
  createHarness,
  failSurface,
  loadBoard,
  poseRefill,
  requestSwap,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

let h: Harness;

/**
 * How far past step 1's boundary the interval reaches, in seconds of game time.
 *
 * Half of `STEP_SECONDS`, which is half of the shortest hold any step can have,
 * so the interval clears step 1's boundary by this much and falls short of step
 * 2's by at least as much. Neither margin depends on a figure the build was free
 * to choose.
 */
const BOUNDARY_MARGIN = STEP_SECONDS / 2;

/** The two divisions of that interval: one whole frame, and sixty. */
const COARSE_FRAMES = 1;
const FINE_FRAMES = 60;

/**
 * The cascade, written as the cells that make each step of it.
 *
 * Nothing here is a run on the posed board — each group is parted by a gem the
 * step before it removes — and the header above walks the two steps.
 */
const CASCADE: PlacedToken[] = [
  // 1: the row-3 rubies, and the one the swap carries down from (5,2).
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 3, token: "R0" },
  { col: 5, row: 2, token: "R0" },
  // 2: column 4's jades, parted by the ruby at (4,3).
  { col: 4, row: 2, token: "J0" },
  { col: 4, row: 4, token: "J0" },
  { col: 4, row: 5, token: "J0" },
];

/** The board the cascade is written on, with one spare swap keeping the round alive. */
const POSED = quietRowsWithEscape(CASCADE);

/** The swap that starts the chain: it completes the rubies across row 3. */
const SWAP_A: CellRef = { col: 5, row: 2 };
const SWAP_B: CellRef = { col: 5, row: 3 };

/**
 * What the refill deals into each column the two steps empty, top down.
 *
 * Step 1 refills row 0 of columns 3, 4 and 5; step 2 refills rows 0 to 2 of
 * column 4. Every letter is chosen so that the refilled gem completes no run
 * with its neighbors, which the check proves over the predicted boards below
 * rather than trusting.
 */
const REFILL: readonly (readonly [col: number, kinds: string])[] = [
  [3, "J"],
  [4, "SJB"],
  [5, "C"],
];

/** The refill pose in the snapshot's own shape, for `settleBoard`. */
const REFILL_KINDS: readonly string[] = Array.from(
  { length: GRID_COLS },
  (_, col) => REFILL.find(([at]) => at === col)?.[1] ?? "",
);

/** Points the two steps score: three plain gems each, at multipliers 1 and 2. */
const STEP_ONE_POINTS = 3 * BASE_SCORE * 1;
const STEP_TWO_POINTS = 3 * BASE_SCORE * 2;

/** The kind letter at each cell, so R7's strain digit is left to its own points. */
function kindsOf(rows: BoardRows): string[] {
  return rows.map((row) =>
    row
      .trim()
      .split(/\s+/)
      .map((token) => (token === WILDCARD ? token : token[0]))
      .join(" "),
  );
}

/**
 * The board R9 leaves after `steps` steps of the chain the swap opens, with the
 * posed refill written in, from specs/rules.md alone: each step clears R5's
 * seed grown by R6 (nothing on the board grows it) and settles.
 */
function boardAfter(steps: number): string[] {
  let rows = swapped(POSED, SWAP_A, SWAP_B);
  for (let step = 0; step < steps; step += 1) {
    const cleared = clearSetFromRuns(rows);
    assertLength(cleared, 3, `cells step ${step + 1} clears`);
    rows = settleBoard(rows, cleared, REFILL_KINDS).rows;
  }
  return rows;
}

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

/**
 * Pose the scenario from the title screen and read the state the REQUEST left.
 *
 * A `reset` first, so the figures one drive leaves behind — its score above
 * all — never reach the next: each drive starts from the same posed round.
 */
async function pose(): Promise<FacetSnapshot> {
  await h.debug.reset();
  await loadBoard(h, POSED);
  await poseRefill(h, REFILL);
  return await requestSwap(h, SWAP_A, SWAP_B);
}

/**
 * The interval both drives cover, read off the build itself.
 *
 * The scenario is posed, the swap carried through its own animation into step 1
 * — which is exactly what `advanceStep` does for a `swapping` board — and the
 * hold that step gave itself is read.
 */
async function driveSeconds(): Promise<number> {
  await pose();
  const resolving = await advanceStep(h);
  assertEqual(resolving.phase, "resolving", "the phase the probe reached");
  assertEqual(resolving.chainStep, 1, "the step the probe reached");
  return SWAP_SECONDS + resolving.stepHold + BOUNDARY_MARGIN;
}

/** Hold one drive's end to the place specs/rules.md puts the move at. */
function assertReached(
  reached: FacetSnapshot,
  span: number,
  expectedKinds: readonly string[],
  drive: string,
): void {
  assertEqual(reached.phase, "resolving", `the phase after ${span}s, ${drive}`);
  assertEqual(reached.chainStep, 2, `the chain step after ${span}s, ${drive}`);
  assertEqual(
    reached.score,
    STEP_ONE_POINTS + STEP_TWO_POINTS,
    `the score after ${span}s, ${drive}`,
  );
  assertEqual(
    reached.lastPoints,
    STEP_TWO_POINTS,
    `the points step 2 scored, ${drive}`,
  );
  assertDeepEqual(
    kindsOf(renderBoard(reached)),
    expectedKinds,
    `the kinds on the board after ${span}s, ${drive}`,
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the same place whether the interval is one frame or sixty", async () => {
  requireSurface();

  // The fixture's own guarantees, asserted here so that anything that fails
  // below is the build's: the posed board carries no run of its own, the swap is
  // one R1 and R3 both accept, the only run it makes is step 1's, and the posed
  // refill completes no run of its own on either board it lands on.
  assertLength(maximalRuns(POSED), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(POSED, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertLength(
    maximalRuns(swapped(POSED, SWAP_A, SWAP_B)),
    1,
    "maximal runs the swap makes",
  );
  const afterTwo = boardAfter(2);
  assertTrue(
    afterTwo.every((row) => !row.includes(WILDCARD)),
    "every refilled cell of the two steps is posed",
  );
  const expectedKinds = kindsOf(afterTwo);
  const afterOne = maximalRuns(boardAfter(1));
  assertLength(afterOne, 1, "maximal runs on the board step 1 leaves");
  assertTrue(
    afterOne[0].cells.every((cell) => cell.col === 4),
    "the run step 1 leaves is column 4's jades",
  );

  const span = await driveSeconds();

  // The whole interval as a single frame. Whatever the build does inside it, it
  // is handed the interval as one delta — both boundaries at once.
  const opened = await pose();
  // specs/rules.md: an accepted swap "exchanges the two cells at once, sets
  // `phase` to `swapping`, sets `swapTimer` to `0`, and leaves `chainStep` at
  // `0`". Nothing has been cleared yet, and that is where both drives begin.
  assertEqual(opened.phase, "swapping", "the phase the accepted swap left");
  assertEqual(opened.chainStep, 0, "the chain step the accepted swap left");
  const coarseStart = opened.simTime;
  await captureReplay(h, "drive", async () => {
    await h.advanceSeconds(span, COARSE_FRAMES);
  });
  const coarse = await h.snapshot();
  assertReached(coarse, span, expectedKinds, "driven as one frame");
  assertCloseTo(
    coarse.simTime - coarseStart,
    span,
    6,
    "the game time the one-frame drive covered",
  );

  // The same interval, sixty frames of it, from the same posed start.
  const reopened = await pose();
  const fineStart = reopened.simTime;
  await h.advanceSeconds(span, FINE_FRAMES);
  const fine = await h.snapshot();
  assertReached(fine, span, expectedKinds, "driven as sixty frames");
  // Summing sixty sixtieths of the interval is not exactly the interval, so the
  // clock is compared at the precision the arithmetic itself allows and no
  // further.
  assertCloseTo(
    fine.simTime - fineStart,
    span,
    6,
    "the game time the sixty-frame drive covered",
  );
});
