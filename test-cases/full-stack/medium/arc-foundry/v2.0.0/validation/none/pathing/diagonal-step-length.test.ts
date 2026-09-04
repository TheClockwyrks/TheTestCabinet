// pathing/diagonal-step-length — a route's length is the sum of its step lengths,
// `1` for an orthogonal step and `sqrt(2)` for a diagonal, and length is what the
// route minimizes.
//
// THREE ANSWERS ARE POSSIBLE AND ONLY ONE IS RIGHT. A build that counts steps
// instead of measuring them reports a shorter figure and prefers a diagonal that
// is not worth taking; a build that refuses diagonals altogether walks the
// Manhattan route and reports a longer one; a build that measures length reports
// the octile figure below. Every route figure in this game is stated in tiles, so
// the maze length is where the three are told apart.
//
// THE INSTRUMENT IS AN EMPTY MAP WHOSE CHAIN RUNS DIAGONALLY. On a yard with no
// walls the least-length route between two tiles is exactly the octile route:
// the shorter axis is covered by diagonal steps and the remainder by orthogonal
// ones, which no other combination of steps can beat. The Switchyard's chain
// crosses the yard on diagonals rather than along the axes, so its empty maze
// length is a known mix of both kinds of step and every one of the three answers
// is a different number. The Substation, whose chain is axis-aligned, could not
// tell them apart at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  STEP_DIAGONAL,
  STEP_ORTHOGONAL,
  chain,
  mapById,
  type Tile,
} from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** The map whose chain crosses the yard on diagonals. */
const MAP = "switchyard";

/** The steps of the least-length route between two tiles on an open grid. */
function octileSteps(
  a: Tile,
  b: Tile,
): {
  diagonals: number;
  orthogonals: number;
} {
  const dc = Math.abs(a.col - b.col);
  const dr = Math.abs(a.row - b.row);
  const diagonals = Math.min(dc, dr);
  return { diagonals, orthogonals: Math.max(dc, dr) - diagonals };
}

/** The whole chain's steps, leg by leg. */
function chainSteps(): { diagonals: number; orthogonals: number } {
  const checkpoints = chain(mapById(MAP));
  let diagonals = 0;
  let orthogonals = 0;
  for (let at = 1; at < checkpoints.length; at += 1) {
    const leg = octileSteps(checkpoints[at - 1]!, checkpoints[at]!);
    diagonals += leg.diagonals;
    orthogonals += leg.orthogonals;
  }
  return { diagonals, orthogonals };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("measures the route in tiles, a diagonal step costing sqrt(2)", async () => {
  await openYard(h, { map: MAP });
  await h.advance(1);
  await captureStill(h, "route");

  const { diagonals, orthogonals } = chainSteps();
  const expected = diagonals * STEP_DIAGONAL + orthogonals * STEP_ORTHOGONAL;

  // A build that counted steps would report this instead, and one that refused
  // diagonals would report the Manhattan figure. Both are named so the failure
  // says which mistake was made.
  const counted = diagonals + orthogonals;
  const manhattan = diagonals * 2 + orthogonals;
  assertGreaterThan(
    expected,
    counted,
    "the sanity of the instrument: the length sum exceeds the step count",
  );
  assertGreaterThan(
    manhattan,
    expected,
    "the sanity of the instrument: the Manhattan sum exceeds the length sum",
  );

  const { mazeLength } = await h.snapshot();
  assertCloseTo(
    mazeLength,
    expected,
    6,
    `the maze length of an empty ${mapById(MAP).name}: ${diagonals} diagonal ` +
      `steps at sqrt(2) and ${orthogonals} orthogonal steps at 1 ` +
      `(a step count would read ${counted.toFixed(4)}, a route with no ` +
      `diagonals ${manhattan.toFixed(4)})`,
  );
});
