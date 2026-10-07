// chain/step-hold-derived — a step's hold is the arithmetic specs/rules.md
// gives, over that step's own two figures.
//
// specs/rules.md builds the hold out of the step's three spans:
// `SHATTER_END = lastWaves * WAVE_SECONDS` (`0.08`),
// `LAND_AT = SHATTER_END + lastFall * FALL_SECONDS_PER_ROW` (`0.05`), and
// `STEP_HOLD = LAND_AT + STEP_SECONDS` (`0.25`). specs/instrumentation.md lists
// `stepHold` among the fields that are DERIVED rather than stored, and names
// exactly that expression as what it is derived from. So the hold is not a
// constant a build picks: it is a sum, and this point is the sum.
//
// WHAT THIS POINT IS AND IS NOT ABOUT. The build's OWN `lastWaves` and
// `lastFall` are fed back into the formula, from the SAME snapshot that reported
// the hold. Whether those two figures are themselves right is decided elsewhere
// — the wave a clear set carries is `expansion`'s, and the fall R9 leaves is
// `settling`'s — and a build that miscounts a wave should fail there once rather
// than here as well for the same fault. What is read here is only that the three
// figures the build reports are consistent with the rule that relates them.
//
// THREE SHAPES, BECAUSE A BUILD THAT RETURNED A CONSTANT ANSWERS ANY SINGLE ONE.
// The shapes are chosen to move both terms of the sum, one at a time:
//
//   1. A PLAIN THREE. A run of three of one kind over the run-free filler, every
//      gem plain at strain 0, so R6's seed is already closed and the clear set
//      is its seed alone — `waves` is `0` by the rule's own last sentence. Each
//      of the three columns loses exactly one cell, so the fall is short too.
//      This is the shortest hold the game has.
//   2. A BRILLIANT'S RING. The same three cells, with the gem the swap carries
//      in cut as a `brilliant`. R6's first addition brings the eight cells
//      surrounding it into the set, at wave `1`, so `waves` is at least `1` and
//      the first term of the sum is non-zero for this shape. The run is still
//      exactly three, so R8 creates nothing and the step stays a plain clear.
//   3. A CLEAR LOW IN A TALL COLUMN. A vertical run of three at the foot of one
//      column: every survivor above it falls three rows and the refill comes in
//      from above the board, so the second term of the sum is large while the
//      first is back at zero.
//
// A build that answered every step with one figure therefore has to answer three
// different sums with it. The check also states, as the scenario's own premise,
// that the three drives really did hand the formula different inputs — the three
// `(lastWaves, lastFall)` pairs are not all the same — so a build that reported
// one constant PAIR is shown as that rather than as an arithmetic fault.
//
// THE TOLERANCE. Three decimal places, which `assertCloseTo` reads as `0.0005`.
// The formula is two products and a sum over figures with two decimal places, so
// the float residue is orders of magnitude below that; and `WAVE_SECONDS`
// (`0.08`) is the smallest amount any term of the sum can move by, which is
// orders of magnitude above it. Nothing conforming lands in between.
//
// Each shape is posed over the run-free filler and driven no further than step
// 1, so no chain settles and the round's end conditions are never reached.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  maximalRuns,
  quietRowsWith,
  stepHold,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/** One shape of step: the board it is posed on, and the swap that opens it. */
interface Shape {
  /** What the shape is for, named in every failure it can produce. */
  what: string;
  cells: readonly PlacedToken[];
  a: CellRef;
  b: CellRef;
  /** How many cells the exchange's single maximal run holds. */
  runLength: number;
}

const SHAPES: readonly Shape[] = [
  {
    what: "a plain three that adds nothing and moves little",
    // Two rubies in row 4 with the third waiting above the gap. The filler holds
    // a citrine at (1,4) and an amethyst at (5,4), so the run is maximal at
    // exactly three.
    cells: [
      { col: 2, row: 4, token: "R0" },
      { col: 3, row: 3, token: "R0" },
      { col: 4, row: 4, token: "R0" },
    ],
    a: { col: 3, row: 3 },
    b: { col: 3, row: 4 },
    runLength: 3,
  },
  {
    what: "a brilliant's ring, which adds a wave",
    // The same three cells, the waiting gem cut as a brilliant. It lands at
    // (3,4) and R6 draws the eight cells around it into the set at wave 1.
    cells: [
      { col: 2, row: 4, token: "R0" },
      { col: 3, row: 3, token: "R0b" },
      { col: 4, row: 4, token: "R0" },
    ],
    a: { col: 3, row: 3 },
    b: { col: 3, row: 4 },
    runLength: 3,
  },
  {
    what: "a clear at the foot of a tall column, which drops its survivors far",
    // A vertical run of three at rows 5 to 7 of column 4, completed by trading
    // the parked ruby at (5,6) into (4,6). Every survivor above it falls three
    // rows and three cells are refilled from above the board.
    cells: [
      { col: 4, row: 5, token: "R0" },
      { col: 4, row: 7, token: "R0" },
      { col: 5, row: 6, token: "R0" },
    ],
    a: { col: 4, row: 6 },
    b: { col: 5, row: 6 },
    runLength: 3,
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports a hold equal to its own waves and fall put through the formula", async () => {
  const readings: FacetSnapshot[] = [];

  for (const shape of SHAPES) {
    const posed = quietRowsWith(shape.cells);
    // Each shape states its own premises: the posed board rests under R4, R1 and
    // R3 accept the swap, and the exchange leaves exactly one maximal run of the
    // length the shape is named for — so the step this drives really is the
    // shape described rather than whatever the filler happened to allow.
    assertLength(
      maximalRuns(posed),
      0,
      `maximal runs on the board posed for ${shape.what}`,
    );
    assertTrue(
      swapIsLegal(posed, shape.a, shape.b),
      `R1 and R3 accept the swap for ${shape.what}`,
    );
    const made = maximalRuns(swapped(posed, shape.a, shape.b));
    assertLength(made, 1, `maximal runs the exchange makes for ${shape.what}`);
    assertLength(
      made[0].cells,
      shape.runLength,
      `cells in the run the exchange makes for ${shape.what}`,
    );

    loadBoard(h, posed);
    readings.push(await swapAndStep(h, shape.a, shape.b));
  }

  // The still is the last shape's board, which is the one with the long fall.
  captureStill(h, "hold");

  for (const [index, reading] of readings.entries()) {
    const shape = SHAPES[index];
    // The drive really landed in a step, so the three figures below describe one.
    assertEqual(reading.chainStep, 1, `the chain step for ${shape.what}`);
    assertEqual(reading.phase, "resolving", `the phase for ${shape.what}`);
    // And the sum: the hold the build reported, against the formula applied to
    // the two figures that same reading reported.
    assertCloseTo(
      reading.stepHold,
      stepHold(reading.lastWaves, reading.lastFall),
      3,
      `the hold reported for ${shape.what}, against ` +
        `${reading.lastWaves} x WAVE_SECONDS + ${reading.lastFall} x ` +
        `FALL_SECONDS_PER_ROW + STEP_SECONDS`,
    );
  }

  // The scenario's own premise, read last so an arithmetic fault is reported as
  // one: the three drives handed the formula more than one pair of figures, so a
  // build answering with a constant is answering three different sums.
  const pairs = new Set(
    readings.map((reading) => `${reading.lastWaves},${reading.lastFall}`),
  );
  assertGreaterThan(
    pairs.size,
    1,
    "distinct (lastWaves, lastFall) pairs the three shapes reported",
  );
});
