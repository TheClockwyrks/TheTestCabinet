// Refract — tracing/shared-node-refused: a press on a node two beams share
// begins no trace.
//
// `specs/controls.md` "Beginning a trace": a press that matches no row begins
// no trace and leaves the board unchanged, and that explicitly covers "a press
// on a node that more than one beam passes through". The board is the private
// SHARED_MID pose: triangle and square both cross the two-charge crystal at
// (1, 0), the crystal is an END of neither beam (so the beam-end row cannot
// match), and the uncovered triangle lens keeps the board unsolved with both
// beams drawn. The press must leave everything the game holds exactly as it
// was: no trace, no shortened beam, no touched node.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";
import {
  SHARED_MID,
  SHARED_MID_SQUARE,
  SHARED_MID_TRIANGLE,
  gameFields,
} from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("begins no trace and leaves the board unchanged", async () => {
  const board = await loadBoard(h, SHARED_MID);
  await traceCells(h, [...SHARED_MID_TRIANGLE]);
  await traceCells(h, [...SHARED_MID_SQUARE]);

  const before = await h.snapshot();
  assertDeepEqual(
    before.beams.triangle?.cells,
    [...SHARED_MID_TRIANGLE],
    "the triangle beam crosses the shared node",
  );
  assertDeepEqual(
    before.beams.square?.cells,
    [...SHARED_MID_SQUARE],
    "the square beam crosses the shared node",
  );

  // The press on the node both beams pass through.
  const shared = center(board, { col: 1, row: 0 });
  await h.debug.pointerDown(shared.x, shared.y);
  await h.advance(1);
  await captureStill(h, "unchanged");

  const after = await h.snapshot();
  assertNull(
    after.tracing,
    "a press on a node more than one beam passes through begins no trace",
  );
  assertDeepEqual(
    gameFields(after),
    gameFields(before),
    "the press leaves the board unchanged",
  );
  await h.debug.pointerUp();
});
