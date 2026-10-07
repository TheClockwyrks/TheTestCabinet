// Facet — moves/refusal-marked: a refused swap marks the two cells it named.
//
// "A chain step" in specs/rules.md says of a refused swap that "it sets `refusal`
// to the two cells it named", and specs/instrumentation.md fixes how that reading
// comes back: `refusal: { a: { col, row }, b: { col, row } } | null`, `null`
// while none stands. It is the only feedback a player gets for a move the rules
// would not take, so a build that refuses silently has told nobody anything.
//
// WHAT IS ASSERTED, AND WHY IT IS ASSERTED AS A PAIR RATHER THAN IN ORDER. The
// two cells the refusal reports are exactly the two the request named. The
// specification says which CELLS are marked; it does not say which of them is
// reported as `a` and which as `b`, so the two are compared as a set — both named
// cells present, and nothing else — which is everything the rule actually fixes.
// A check that demanded `a` be the first argument of the request would fail a
// build that is conformant on every word the specification wrote.
//
// The refusal's LIFETIME is a separate item (`moves/refusal-expires`) and is not
// read here; the reading is taken with no frame advanced, while the mark is
// certainly still standing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertHasProperty,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  areAdjacent,
  quietRowsWithEscape,
  maximalRuns,
  swapWouldMatch,
  type BoardRows,
  type CellRef,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  requestSwap,
  type Harness,
} from "../harness";

/** The run-free filler: nothing on it makes a run, so a swap on it is refused. */
const ROWS: BoardRows = quietRowsWithEscape([]);

/** The pair named in the request: adjacent, both plain, and unproductive. */
const PAIR: { a: CellRef; b: CellRef } = {
  a: { col: 5, row: 2 },
  b: { col: 5, row: 3 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Two cells as comparable text, ordered so the comparison is about the SET. */
function asPair(cells: readonly CellRef[]): string[] {
  return cells.map(({ col, row }) => `(${col},${row})`).sort();
}

it("reports the two cells the refused request named", async () => {
  // The fixture: a request R1 admits and R3 refuses, so a refusal really is what
  // this board answers with.
  assertTrue(areAdjacent(PAIR.a, PAIR.b), "the pair is orthogonally adjacent");
  assertLength(maximalRuns(ROWS), 0, "runs on the posed board");
  assertTrue(
    !swapWouldMatch(ROWS, PAIR.a, PAIR.b),
    "the exchange makes NO maximal run",
  );

  await loadBoard(h, ROWS);
  const refused = await requestSwap(h, PAIR.a, PAIR.b);

  // One frame, so the picture kept as evidence shows the mark as the build drew
  // it. Far short of REFUSAL_SECONDS, so the mark is still standing.
  await h.advance(1);
  await captureStill(h, "refusal");

  assertNotNull(refused.refusal, "refusal after the refused request");
  const { refusal } = refused;
  if (refusal === null) return;
  assertHasProperty(refusal, "a", "the reported refusal");
  assertHasProperty(refusal, "b", "the reported refusal");
  assertDeepEqual(
    asPair([refusal.a, refusal.b]),
    asPair([PAIR.a, PAIR.b]),
    "the cells the refusal marks",
  );
});
