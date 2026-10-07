// ruleset/r1-adjacency — R1 Adjacency: a segment joins two different nodes
// whose cells differ by at most 1 in column and at most 1 in row.
//
// THE POSE. `R1_NON_ADJACENT` ("T.T") puts the two triangle emitters two
// columns apart with an empty cell between them, so from a trace begun at
// T(0, 0) both halves of the rule are attempted from one live end:
//
//   1. The pointer over T(2, 0) — a real node, two columns from the live end.
//      Not 8-adjacent, so the move is refused (specs/beams.md R1; the
//      enforcement table: the beam is unchanged and the trace stays live).
//   2. The pointer over (1, 0) — the empty cell between them. An empty cell
//      holds no node and is never part of a beam, and the pointer targets no
//      node there (specs/controls.md), so the sweep adds nothing.
//
// Nothing here can be refused for any other reason: the target in (1) is the
// channel's own fresh emitter and the segment would be new, so adjacency is
// the only rule in play.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R1_NON_ADJACENT } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";
import { moveOver, pressAt } from "./drive";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a move to a node two columns away, and a sweep across an empty cell adds nothing", async () => {
  const board = await loadBoard(h, R1_NON_ADJACENT);

  // Begin the trace at T(0, 0): an emitter of a channel whose beam carries no
  // segments, the first row of the grab table (specs/controls.md).
  await pressAt(h, board, { col: 0, row: 0 });
  const before = await h.snapshot();
  assertDeepEqual(
    before.tracing,
    { channel: "triangle", live: { col: 0, row: 0 } },
    "the press at T(0, 0) begins the triangle trace",
  );

  // The non-adjacent node: two columns from the live end.
  await moveOver(h, board, { col: 2, row: 0 });
  const afterFar = await h.snapshot();

  // The empty cell between the emitters.
  await moveOver(h, board, { col: 1, row: 0 });
  const afterEmpty = await h.snapshot();

  // One frame so the canvas shows the refused state, then the evidence.
  await h.advance(1);
  await captureStill(h, "refused");
  await h.debug.pointerUp();

  assertDeepEqual(
    afterFar.beams,
    before.beams,
    "the beam is unchanged by the move to a node two columns away",
  );
  assertDeepEqual(
    afterFar.tracing,
    before.tracing,
    "the trace stays live through the refused non-adjacent move",
  );
  assertDeepEqual(
    afterEmpty.beams,
    before.beams,
    "the sweep across the empty cell adds nothing",
  );
  assertDeepEqual(
    afterEmpty.tracing,
    before.tracing,
    "the trace stays live across the empty cell",
  );
});
