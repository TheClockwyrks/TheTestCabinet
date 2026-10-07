// Refract — ruleset/r1-adjacency: R1 Adjacency.
//
// specs/beams.md R1: "A segment joins two nodes whose cells differ by at most 1
// in column and at most 1 in row and are not the same cell. Empty cells hold no
// node and are never part of a beam. A segment never spans an empty cell." The
// board is R1_NON_ADJACENT ("T.T"): its two emitters are two columns apart with
// an empty cell between, so a move to the far emitter is refused (not
// 8-adjacent) and a sweep across the empty cell adds nothing (no node to
// extend to). Per the enforcement table, a refused move leaves the beam
// unchanged and the trace live.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { R1_NON_ADJACENT } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  moveToCell,
  pressCell,
  resetTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a non-adjacent move is refused and an empty cell adds nothing", async () => {
  await resetTo(h);
  await loadBoard(h, R1_NON_ADJACENT);

  // A press on the emitter starts the beam there: one cell, no segments
  // (specs/state.md: "a beam that has been started at an emitter and not yet
  // extended carries one cell and no segments").
  pressCell(h, { col: 0, row: 0 });
  const begun = h.snapshot();
  assertDeepEqual(
    begun.beams.triangle?.cells,
    [{ col: 0, row: 0 }],
    "the press starts the beam at T(0,0)",
  );
  assertNotNull(begun.tracing, "the press begins a trace");

  // The move to T(2,0), two columns from the live end: the two cells are not
  // 8-adjacent, so R1 refuses the segment and the beam is unchanged.
  moveToCell(h, { col: 2, row: 0 });
  const afterFar = h.snapshot();
  assertDeepEqual(
    afterFar.beams.triangle?.cells,
    [{ col: 0, row: 0 }],
    "the move to a node two columns away is refused",
  );
  assertNotNull(afterFar.tracing, "the refused move leaves the trace live");

  // The sweep across the adjacent empty cell (1,0): an empty cell holds no
  // node, so nothing is added.
  moveToCell(h, { col: 1, row: 0 });
  const afterEmpty = h.snapshot();
  assertDeepEqual(
    afterEmpty.beams.triangle?.cells,
    [{ col: 0, row: 0 }],
    "the sweep across the empty cell adds nothing",
  );
  assertNotNull(afterEmpty.tracing, "the trace stays live over the empty cell");

  // Evidence: the beam unchanged by the non-adjacent move.
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "refused");
});
