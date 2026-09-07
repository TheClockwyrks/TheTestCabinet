// ruleset/r3-second-channel — R3: each segment carries at most one beam, so a
// second channel may not draw a segment another channel's beam holds.
//
// The pose needs a board where R3 is the ONLY rule the attempted segment
// breaks. Crystals are the way out: their capacity is counted in crossings
// against charges, not segments, and they are channel-neutral (specs/beams.md
// R8), so R2 has nothing to say about a second channel entering them.
//
//   On `T22T / S..S` the triangle solves its row through both crystals, then
//   the square enters A(1,0) by a fresh diagonal and attempts A->B — the exact
//   segment the triangle's beam carries. B has an unspent charge and the
//   crossing diagonal ledger is untouched, so only R3 refuses.
//
// The board is written in specs/board.md notation here because no shared
// fixture poses a pure-R3 refusal; every figure above traces to specs/beams.md.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
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

/** Two channels over two 2-charge crystals sharing the segment A(1,0)-B(2,0). */
const SECOND_CHANNEL = `
T22T
S..S
`;

/** The board is 4 columns by 2 rows. */
const COLS = 4;
const ROWS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h);
  await loadBoard(h, SECOND_CHANNEL);
});

afterEach(() => {
  h?.dispose();
});

it("refuses a second channel drawing a segment another beam holds", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  // The triangle's beam takes A(1,0)-B(2,0) on its way across the row.
  traceRoute(h, [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ]);

  // The square reaches A by a fresh diagonal and attempts the same segment.
  h.debug.pointerDown(at(0, 1).x, at(0, 1).y);
  h.debug.pointerMove(at(1, 0).x, at(1, 0).y);
  const before = h.snapshot();
  assertDeepEqual(
    before.beams.square?.cells,
    [
      { col: 0, row: 1 },
      { col: 1, row: 0 },
    ],
    "the square beam enters the first crystal by a fresh diagonal — the " +
      "crystal is channel-neutral and holds an unspent charge (specs/beams.md)",
  );

  h.debug.pointerMove(at(2, 0).x, at(2, 0).y);
  const after = h.snapshot();
  assertDeepEqual(
    after.beams,
    before.beams,
    "R3: a second channel drawing the same segment is refused — both beams " +
      "are unchanged (specs/beams.md: each segment carries at most one beam)",
  );
  assertLiveTrace(
    after,
    "square",
    { col: 1, row: 0 },
    "the refused second use leaves the trace live",
  );

  // Evidence: the segment refused a second use, with the square mid-trace.
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.pointerUp();
});
