// ruleset/r4-diagonal-exclusivity — R4: the two diagonals of any 2x2 block of
// cells are mutually exclusive.
//
// The board is the R4_CROSS_2X2 fixture, `TS / ST`: the only routes either
// channel has are the two diagonals of the single 2x2 block, so once one is
// drawn the other is the crossing diagonal — a fresh segment onto the
// channel's own fresh emitter, refused by R4 alone. The manifest item demands
// the refusal in whichever order the two are attempted, so the suite runs the
// block both ways: square first then triangle refused, and (after reloading
// the board) triangle first then square refused.
//
// Either first diagonal completes its channel's beam, but the board never
// solves — the other channel's beam is empty, so R9 cannot hold — and play
// continues. Refusal is read as specs/beams.md Enforcement states it: the
// beam unchanged, the trace still live.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R4_CROSS_2X2 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  traceRoute,
  type Harness,
} from "../harness";
import { assertLiveTrace } from "./support";

/** R4_CROSS_2X2 is `TS / ST`: 2 columns, 2 rows. */
const COLS = 2;
const ROWS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h);
  await loadBoard(h, R4_CROSS_2X2);
});

afterEach(() => {
  h?.dispose();
});

it("refuses the crossing diagonal, whichever order the two are attempted in", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  // Order 1 — square draws its diagonal S(1,0)-S(0,1); the triangle's
  // T(0,0)-T(1,1) is now the other diagonal of the same block.
  traceRoute(h, [
    [1, 0],
    [0, 1],
  ]);
  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  const beforeTriangle = h.snapshot();
  assertLiveTrace(
    beforeTriangle,
    "triangle",
    { col: 0, row: 0 },
    "the press on the triangle emitter begins the trace",
  );

  h.debug.pointerMove(at(1, 1).x, at(1, 1).y);
  const triangleRefused = h.snapshot();
  assertDeepEqual(
    triangleRefused.beams,
    beforeTriangle.beams,
    "R4: with the square's diagonal drawn, the crossing diagonal is refused " +
      "— the beams are unchanged (specs/beams.md)",
  );
  assertLiveTrace(
    triangleRefused,
    "triangle",
    { col: 0, row: 0 },
    "the refused crossing diagonal leaves the trace live",
  );

  // Evidence: the crossing diagonal refused, the first diagonal still drawn.
  await h.advance(1);
  captureStill(h, "refused");
  h.debug.pointerUp();

  // Order 2 — a fresh board; triangle draws its diagonal first, and the
  // square's S(1,0)-S(0,1) is the one refused.
  await loadBoard(h, R4_CROSS_2X2);
  traceRoute(h, [
    [0, 0],
    [1, 1],
  ]);
  h.debug.pointerDown(at(1, 0).x, at(1, 0).y);
  const beforeSquare = h.snapshot();
  assertLiveTrace(
    beforeSquare,
    "square",
    { col: 1, row: 0 },
    "the press on the square emitter begins the trace",
  );

  h.debug.pointerMove(at(0, 1).x, at(0, 1).y);
  const squareRefused = h.snapshot();
  assertDeepEqual(
    squareRefused.beams,
    beforeSquare.beams,
    "R4: with the triangle's diagonal drawn, the crossing diagonal is " +
      "refused in the other order too — the beams are unchanged " +
      "(specs/beams.md)",
  );
  assertLiveTrace(
    squareRefused,
    "square",
    { col: 1, row: 0 },
    "the refusal in the other order leaves the trace live",
  );
  h.debug.pointerUp();
});
