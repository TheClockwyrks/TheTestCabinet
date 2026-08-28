// Refract — tracing/shorten-keeps-last-occurrence: shortening keeps a repeated
// node's last occurrence.
//
// `specs/controls.md` "The drawn order and shortening": a beam that crosses a
// node more than once carries that node more than once, and on a shortening
// press the LAST of those occurrences in the held order is the one kept, "so
// the beam loses as few segments as it can". The beam here crosses the
// two-charge crystal of `CRYSTAL_TWICE` twice —
// [A, X, (0,2), (1,2), X, (1,0)] with X the crystal at (1, 1) — and stops
// short of solving. The press on X must drop only what follows X's SECOND
// occurrence (one segment), never the four that follow its first.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CRYSTAL_TWICE } from "../fixtures";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";

/** The crystal's cell on the CRYSTAL_TWICE board. */
const X = { col: 1, row: 1 } as const;

/** A partial double crossing: both charges spent, board nowhere near solved. */
const DOUBLE_CROSS = [
  { col: 0, row: 0 },
  { col: 1, row: 1 },
  { col: 0, row: 2 },
  { col: 1, row: 2 },
  { col: 1, row: 1 },
  { col: 1, row: 0 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops only the cells after the crystal's last occurrence", async () => {
  const board = await loadBoard(h, CRYSTAL_TWICE);
  await traceCells(h, [...DOUBLE_CROSS]);

  const drawn = await h.snapshot();
  assertDeepEqual(
    drawn.beams.triangle?.cells,
    [...DOUBLE_CROSS],
    "the beam crosses the crystal twice",
  );
  assertEqual(
    (drawn.beams.triangle?.cells ?? []).filter(
      (cell) => cell.col === X.col && cell.row === X.row,
    ).length,
    2,
    "the twice-crossed cell is carried twice in the drawn order",
  );

  // The press on the crystal: a node exactly one beam passes through, so it
  // shortens — and it must cut at the SECOND occurrence, keeping five cells.
  const at = center(board, X);
  await h.debug.pointerDown(at.x, at.y);
  await h.advance(1);
  await captureStill(h, "shortened");

  const after = await h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    DOUBLE_CROSS.slice(0, 5),
    "the cells after the LAST occurrence are dropped, and no others",
  );
  assertDeepEqual(
    after.tracing,
    { channel: "triangle", live: { col: X.col, row: X.row } },
    "the trace resumes from the pressed node",
  );
  await h.debug.pointerUp();
});
