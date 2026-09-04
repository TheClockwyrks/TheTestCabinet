// pathing/no-corner-cut — a diagonal step is taken only when both tiles it cuts
// past are crossable, so the Load never squeezes through the gap between two
// diagonally touching walls.
//
// WHY THE RULE EXISTS. Without it a staircase of walls is no wall at all: the
// route threads every corner and the player's maze is worth a fraction of what it
// cost. `specs/pathing.md` states the rule on the step, and the reading that
// decides it is the route's LENGTH, because a build that cuts corners reports a
// shorter maze than one that does not.
//
// THE INSTRUMENT IS A STAIRCASE FROM THE TOP EDGE. Five footprints step down and
// to the right, each touching the next only at a corner, and together they cross
// the `Entry -> WP1` leg. Going around means dropping below the staircase's
// bottom step and climbing back, and every corner along the way is a shortcut a
// cutting build would take. Both figures are computed from the step lengths
// `specs/pathing.md` fixes, so the failure names which route was walked:
//
//   around  10 diagonal steps and 34 orthogonal, over 44 columns
//   cutting 44 columns with two corners cut, one row down and one row back
//
// The staircase stops short of the yard's lower half, so every leg keeps an open
// route and the never-seal rule refuses none of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  chain,
  mapById,
  STEP_DIAGONAL,
  STEP_ORTHOGONAL,
  type Tile,
} from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standBlocker,
  type Harness,
} from "../harness";

/** The staircase: five footprints, each touching the next at a corner alone. */
const STAIRCASE = [
  { col: 20, row: 0 },
  { col: 22, row: 2 },
  { col: 24, row: 4 },
  { col: 26, row: 6 },
  { col: 28, row: 8 },
];

/** The leg the staircase crosses, from the entry to WP1 along row 5. */
const LEG_COLUMNS = 44;

/** Going around: down five rows to clear the bottom step, and back up five. */
const AROUND_DIAGONALS = 10;

/** Cutting: the same 44 columns, dipping one row and back through two corners. */
const CUTTING_DIAGONALS = 2;

/** The least-length route between two tiles on an open grid, in tiles. */
function octile(a: Tile, b: Tile): number {
  const dc = Math.abs(a.col - b.col);
  const dr = Math.abs(a.row - b.row);
  const diagonals = Math.min(dc, dr);
  return (
    diagonals * STEP_DIAGONAL + (Math.max(dc, dr) - diagonals) * STEP_ORTHOGONAL
  );
}

/** The legs the staircase does not touch, which keep their empty-yard lengths. */
function untouchedLegs(): number {
  const checkpoints = chain(mapById("substation"));
  let total = 0;
  for (let at = 2; at < checkpoints.length; at += 1) {
    total += octile(checkpoints[at - 1]!, checkpoints[at]!);
  }
  return total;
}

/** A route of `columns` columns that spends `diagonals` of them going up or down. */
function routeLength(columns: number, diagonals: number): number {
  return diagonals * STEP_DIAGONAL + (columns - diagonals) * STEP_ORTHOGONAL;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("routes around a diagonal pinch rather than threading its corner", async () => {
  await openYard(h);
  for (const step of STAIRCASE) await standBlocker(h, step.col, step.row);
  await h.advance(1);
  await captureStill(h, "pinch");

  const rest = untouchedLegs();
  const around = rest + routeLength(LEG_COLUMNS, AROUND_DIAGONALS);
  const cutting = rest + routeLength(LEG_COLUMNS, CUTTING_DIAGONALS);

  const { mazeLength } = await h.snapshot();
  assertGreaterThan(
    mazeLength,
    cutting,
    `the maze length with the staircase standing: a route that cut a corner ` +
      `of it would read ${cutting.toFixed(4)}, and a diagonal step is taken ` +
      `only when both tiles it cuts past are crossable (specs/pathing.md)`,
  );
  assertCloseTo(
    mazeLength,
    around,
    4,
    `the maze length of the route around the staircase: ${AROUND_DIAGONALS} ` +
      `diagonal steps and ${LEG_COLUMNS - AROUND_DIAGONALS} orthogonal ones ` +
      `across the Entry -> WP1 leg, plus ${rest.toFixed(4)} for the six legs ` +
      `the staircase does not touch`,
  );
});
