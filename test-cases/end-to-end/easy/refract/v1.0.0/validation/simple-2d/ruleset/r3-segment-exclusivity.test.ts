// ruleset/r3-segment-exclusivity — R3: each segment carries at most one beam
// and is used at most once.
//
// The manifest item names two probes, and each needs a board where R3 is the
// ONLY rule the attempted segment breaks. That takes care: the far node of a
// redrawn segment already carries that segment, so a lens there would be at
// or near capacity (R5) and a plain retreat to the node behind the live end
// is retracting, not redrawing (specs/controls.md). Crystals are the way out:
// their capacity is counted in crossings against charges, not segments, so a
// crystal with an unspent charge accepts entry — leaving R3 alone to refuse.
//
//   1. SAME BEAM redraws a segment it already holds: on `T33T / .tt.` the
//      triangle beam loops T(0,0)-A(1,0)-B(2,0)-t(2,1)-t(1,1)-A(1,0) — both
//      crystals carry 3 charges, so every entry finds an unspent charge — and
//      the move A->B would redraw the beam's own second segment. The node
//      behind the live end is t(1,1), so this is an extension attempt, and B
//      still has unspent charges, so only R3 refuses it.
//
//   2. A SECOND CHANNEL draws a segment another beam holds: on `T22T / S..S`
//      the triangle solves its row through both crystals, then the square
//      enters A(1,0) by a fresh diagonal and attempts A->B — the exact
//      segment the triangle's beam carries. B has an unspent charge, the
//      crystals are channel-neutral (R2 does not apply), so only R3 refuses.
//
// Both boards are written in specs/board.md notation here because no shared
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

/** One channel over two 3-charge crystals: room to loop back to A(1,0). */
const SAME_BEAM = `
T33T
.tt.
`;

/** Two channels over two 2-charge crystals sharing the segment A(1,0)-B(2,0). */
const SECOND_CHANNEL = `
T22T
S..S
`;

/** Both boards are 4 columns by 2 rows. */
const COLS = 4;
const ROWS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

it("refuses redrawing a segment the beam already holds, and a second channel drawing it", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  // Probe 1 — the same beam. Loop back to crystal A(1,0) and attempt the
  // beam's own second segment again.
  await loadBoard(h, SAME_BEAM);
  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  for (const [col, row] of [
    [1, 0],
    [2, 0],
    [2, 1],
    [1, 1],
    [1, 0],
  ] as const) {
    h.debug.pointerMove(at(col, row).x, at(col, row).y);
  }
  const beforeRedraw = h.snapshot();
  assertDeepEqual(
    beforeRedraw.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 2, row: 1 },
      { col: 1, row: 1 },
      { col: 1, row: 0 },
    ],
    "the loop back to the first crystal is drawn — every segment of it is " +
      "permitted (specs/beams.md)",
  );

  h.debug.pointerMove(at(2, 0).x, at(2, 0).y);
  const redrawn = h.snapshot();
  assertDeepEqual(
    redrawn.beams,
    beforeRedraw.beams,
    "R3: redrawing a segment the same beam already holds is refused — the " +
      "beam is unchanged (specs/beams.md: each segment is used at most once)",
  );
  assertLiveTrace(
    redrawn,
    "triangle",
    { col: 1, row: 0 },
    "the refused redraw leaves the trace live",
  );
  h.debug.pointerUp();

  // Probe 2 — a second channel. The triangle's beam holds A(1,0)-B(2,0); the
  // square reaches A and attempts the same segment.
  await loadBoard(h, SECOND_CHANNEL);
  traceRoute(h, [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ]);
  h.debug.pointerDown(at(0, 1).x, at(0, 1).y);
  h.debug.pointerMove(at(1, 0).x, at(1, 0).y);
  const beforeSecond = h.snapshot();
  assertDeepEqual(
    beforeSecond.beams.square?.cells,
    [
      { col: 0, row: 1 },
      { col: 1, row: 0 },
    ],
    "the square beam enters the first crystal by a fresh diagonal — the " +
      "crystal is channel-neutral and holds an unspent charge (specs/beams.md)",
  );

  h.debug.pointerMove(at(2, 0).x, at(2, 0).y);
  const second = h.snapshot();
  assertDeepEqual(
    second.beams,
    beforeSecond.beams,
    "R3: a second channel drawing the same segment is refused — both beams " +
      "are unchanged (specs/beams.md: each segment carries at most one beam)",
  );
  assertLiveTrace(
    second,
    "square",
    { col: 1, row: 0 },
    "the refused second use leaves the trace live",
  );

  // Evidence: the segment refused a second use, with the square mid-trace.
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.pointerUp();
});
