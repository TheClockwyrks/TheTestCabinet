// ruleset/r4-diagonal-exclusivity — R4: the two diagonals of any 2x2 block of
// cells are mutually exclusive.
//
// THE POSE. `R4_CROSS_2X2` is the single 2x2 block with an emitter in every
// corner:
//
//   TS
//   ST
//
// Whichever channel draws its diagonal first, the other channel's diagonal —
// the crossing one — must be refused, and for no other reason: the crossing
// segment is fresh, both of its emitters are untouched, and the target is the
// channel's own. The manifest asks for BOTH orders, so the board is posed
// twice — a fresh `loadBoard` between them, which puts every beam back to
// empty (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R4_CROSS_2X2 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  traceCells,
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

it("refuses the crossing diagonal, whichever order the two are attempted in", async () => {
  // Order one: square draws its diagonal, triangle's crossing one is refused.
  let board = await loadBoard(h, R4_CROSS_2X2);
  await traceCells(h, [
    { col: 1, row: 0 },
    { col: 0, row: 1 },
  ]);
  await pressAt(h, board, { col: 0, row: 0 });
  const beforeTriangle = await h.snapshot();
  assertDeepEqual(
    beforeTriangle.tracing,
    { channel: "triangle", live: { col: 0, row: 0 } },
    "the press at T(0, 0) begins the triangle trace",
  );
  await moveOver(h, board, { col: 1, row: 1 });
  const afterTriangle = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "refused");
  await h.debug.pointerUp();

  // Order two: a fresh board, triangle draws its diagonal first, square's
  // crossing one is refused.
  board = await loadBoard(h, R4_CROSS_2X2);
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  await pressAt(h, board, { col: 1, row: 0 });
  const beforeSquare = await h.snapshot();
  assertDeepEqual(
    beforeSquare.tracing,
    { channel: "square", live: { col: 1, row: 0 } },
    "the press at S(1, 0) begins the square trace",
  );
  await moveOver(h, board, { col: 0, row: 1 });
  const afterSquare = await h.snapshot();
  await h.debug.pointerUp();

  assertDeepEqual(
    afterTriangle.beams,
    beforeTriangle.beams,
    "square's diagonal drawn first: triangle's crossing diagonal is refused",
  );
  assertDeepEqual(
    afterTriangle.tracing,
    beforeTriangle.tracing,
    "the triangle trace stays live through the refusal",
  );
  assertDeepEqual(
    afterSquare.beams,
    beforeSquare.beams,
    "triangle's diagonal drawn first: square's crossing diagonal is refused",
  );
  assertDeepEqual(
    afterSquare.tracing,
    beforeSquare.tracing,
    "the square trace stays live through the refusal",
  );
});
