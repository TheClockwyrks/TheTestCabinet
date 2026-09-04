// ruleset/r3-same-beam-redraw — R3: a segment is used at most once, so a beam
// may not redraw a segment it already holds.
//
// The pose needs a board where R3 is the ONLY rule the attempted segment
// breaks. That takes care: the far node of a redrawn segment already carries
// that segment, so a lens there would be at or near capacity (R5), and a plain
// retreat to the node behind the live end is retracting, not redrawing
// (specs/controls.md). Crystals are the way out: their capacity is counted in
// crossings against charges, not segments, so a crystal with an unspent charge
// accepts entry — leaving R3 alone to refuse.
//
//   On `T33T / .tt.` the triangle beam loops T(0,0)-A(1,0)-B(2,0)-t(2,1)-
//   t(1,1)-A(1,0) — both crystals carry 3 charges, so every entry finds an
//   unspent charge — and the move A->B would redraw the beam's own second
//   segment. The node behind the live end is t(1,1), so this is an extension
//   attempt, and B still has unspent charges, so only R3 refuses it.
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
  type Harness,
} from "../harness";
import { assertLiveTrace } from "./support";

/** One channel over two 3-charge crystals: room to loop back to A(1,0). */
const SAME_BEAM = `
T33T
.tt.
`;

/** The board is 4 columns by 2 rows. */
const COLS = 4;
const ROWS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
  await loadBoard(h, SAME_BEAM);
});

afterEach(() => {
  h?.dispose();
});

it("refuses redrawing a segment the beam already holds", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  // Loop back to crystal A(1,0) and attempt the beam's own second segment.
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
  const before = h.snapshot();
  assertDeepEqual(
    before.beams.triangle?.cells,
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
  const after = h.snapshot();
  assertDeepEqual(
    after.beams,
    before.beams,
    "R3: redrawing a segment the same beam already holds is refused — the " +
      "beam is unchanged (specs/beams.md: each segment is used at most once)",
  );
  assertLiveTrace(
    after,
    "triangle",
    { col: 1, row: 0 },
    "the refused redraw leaves the trace live",
  );

  // Evidence: the segment refused a second use, mid-trace.
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.pointerUp();
});
