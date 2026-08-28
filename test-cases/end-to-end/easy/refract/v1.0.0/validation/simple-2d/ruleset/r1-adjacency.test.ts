// ruleset/r1-adjacency — R1: a segment joins two nodes whose cells differ by
// at most 1 in column and at most 1 in row.
//
// specs/beams.md R1 adds the two edges this suite pokes: cells two apart are
// not adjacent, and "empty cells hold no node and are never part of a beam. A
// segment never spans an empty cell." The board is the R1_NON_ADJACENT fixture,
// `T.T` — two emitters two columns apart with an empty cell between them — so
// the only moves on offer are the two the rule refuses: the far emitter (two
// columns from the live end) and the empty cell (no node at all).
//
// The pose runs through the surface's pointer operations, which feed the same
// input path a player's pointer feeds (specs/instrumentation.md), and every
// refusal is read as specs/beams.md Enforcement states it: the beam unchanged,
// the trace still live.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R1_NON_ADJACENT } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";
import { assertLiveTrace } from "./support";

/** R1_NON_ADJACENT is `T.T`: 3 columns, 1 row. */
const COLS = 3;
const ROWS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
  await loadBoard(h, R1_NON_ADJACENT);
});

afterEach(() => {
  h?.dispose();
});

it("refuses the non-adjacent node and adds nothing over the empty cell", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  // Begin the trace at the left emitter. The node the trace began at is the
  // live end (specs/controls.md "Beginning a trace").
  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  const before = h.snapshot();
  assertLiveTrace(
    before,
    "triangle",
    { col: 0, row: 0 },
    "the press on the emitter begins the trace",
  );

  // A move to the far emitter, two columns from the live end: the cells
  // differ by 2 in column, so R1 refuses the segment.
  h.debug.pointerMove(at(2, 0).x, at(2, 0).y);
  let swept = h.snapshot();
  assertDeepEqual(
    swept.beams,
    before.beams,
    "R1: a move to a node two columns from the live end is refused — " +
      "the beam is unchanged (specs/beams.md)",
  );
  assertLiveTrace(
    swept,
    "triangle",
    { col: 0, row: 0 },
    "the refused non-adjacent move leaves the trace live",
  );

  // A sweep back across the empty cell between the emitters: the cell holds
  // no node, and a segment never spans an empty cell (specs/beams.md R1).
  h.debug.pointerMove(at(1, 0).x, at(1, 0).y);
  swept = h.snapshot();
  assertDeepEqual(
    swept.beams,
    before.beams,
    "R1: a sweep across an empty cell adds nothing — the beam is unchanged " +
      "(specs/beams.md: empty cells hold no node and are never part of a beam)",
  );
  assertLiveTrace(
    swept,
    "triangle",
    { col: 0, row: 0 },
    "the sweep across the empty cell leaves the trace live",
  );

  // Evidence: the beam unchanged by the non-adjacent move, still mid-trace.
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.pointerUp();
});
