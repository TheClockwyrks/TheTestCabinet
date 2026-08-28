// Refract — tracing/grab-end-wins-over-mid: a beam's end wins over another
// beam's middle.
//
// `specs/controls.md` "Beginning a trace": the grab rows are EVALUATED IN
// ORDER, and the first row that matches is the one that applies. On the
// SHARED_CRYSTAL board the triangle beam crosses the two-charge crystal at
// (1, 0) while the square beam ENDS on it — a crossing begun and not
// completed, which is legal, merely unsatisfying R8. So the pressed node is
// one beam's end (row two) and a mid cell of another; the row-two match must
// win: the square beam resumes from its end, nothing shortens, and no beam
// changes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { SHARED_CRYSTAL } from "../fixtures";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";

/** Triangle, straight across the top, crossing the crystal mid-beam. */
const TRIANGLE_ACROSS = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
  { col: 2, row: 0 },
] as const;

/** Square, ending ON the crystal: (1, 0) is that beam's live end. */
const SQUARE_TO_CRYSTAL = [
  { col: 0, row: 1 },
  { col: 1, row: 0 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resumes the beam whose end the pressed node is", async () => {
  const board = await loadBoard(h, SHARED_CRYSTAL);
  await traceCells(h, [...TRIANGLE_ACROSS]);
  await traceCells(h, [...SQUARE_TO_CRYSTAL]);

  const before = await h.snapshot();
  assertDeepEqual(
    before.beams.square?.cells,
    [...SQUARE_TO_CRYSTAL],
    "the square beam ends on the crystal",
  );

  const at = center(board, { col: 1, row: 0 });
  await h.debug.pointerDown(at.x, at.y);
  await h.advance(1);
  await captureStill(h, "grabbed");

  const after = await h.snapshot();
  assertDeepEqual(
    after.tracing,
    { channel: "square", live: { col: 1, row: 0 } },
    "the end row is evaluated before the mid row: the square beam resumes",
  );
  assertDeepEqual(
    after.beams.square?.cells,
    [...SQUARE_TO_CRYSTAL],
    "resuming from the beam's own end drops nothing",
  );
  assertDeepEqual(
    after.beams.triangle?.cells,
    [...TRIANGLE_ACROSS],
    "the beam the node is a mid cell of is not shortened",
  );
  await h.debug.pointerUp();
});
