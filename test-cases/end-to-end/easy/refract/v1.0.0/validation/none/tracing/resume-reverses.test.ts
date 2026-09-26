// Refract — tracing/resume-reverses: resuming from the other end reverses the
// drawn order.
//
// The drawn-order rule in `specs/controls.md`: a beam's cells are held in the
// order they were drawn, and whenever a trace begins on a beam, the beam is
// first oriented so that the node the trace extends from is its LAST cell —
// "reversing the held order when the trace begins from the other end". Both
// halves of the rule are read back through the snapshot, whose `cells` list is
// specified to be in drawn order (`specs/instrumentation.md`).
//
// The press on the far end A shows the reversal: [A, B, C] reads back
// [C, B, A] with the trace live at A. A SEGMENT added from A itself would be a
// second segment on the emitter the beam started at, which R5 refuses whatever
// the board (`specs/beams.md`), so the "extends from that end" half is shown
// where the limits permit it: the beam's drawn order now ends at A, making C
// the OTHER end — a lens with one segment — and pressing C reorients back to
// [A, B, C] and extends to D. Two far-end presses, each reversing the held
// order, the second extending.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";
import { LINE_5 } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reorients the beam so the pressed far end is its last cell", async () => {
  const board = await loadBoard(h, LINE_5);
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 2, row: 0 },
  ]);

  // The live end is C (2, 0); the far end is A (0, 0). Pressing A reverses
  // the held order and resumes the trace from A.
  const a = center(board, { col: 0, row: 0 });
  await h.debug.pointerDown(a.x, a.y);
  await h.advance(1);
  await captureStill(h, "reversed");
  const reversed = await h.snapshot();
  assertDeepEqual(
    reversed.beams.triangle?.cells,
    [
      { col: 2, row: 0 },
      { col: 1, row: 0 },
      { col: 0, row: 0 },
    ],
    "the cells read in reversed order: the pressed far end is last",
  );
  assertDeepEqual(
    reversed.tracing,
    { channel: "triangle", live: { col: 0, row: 0 } },
    "the trace extends from the pressed end",
  );
  await h.debug.pointerUp();

  // The beam as drawn is now [C, B, A], so C is the far end in its turn.
  // Pressing it reverses the order again, and this end — a lens carrying one
  // segment — CAN take another, so the resumed trace really extends.
  const c = center(board, { col: 2, row: 0 });
  await h.debug.pointerDown(c.x, c.y);
  const again = await h.snapshot();
  assertDeepEqual(
    again.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ],
    "pressing the new far end reverses the held order back",
  );
  const d = center(board, { col: 3, row: 0 });
  await h.debug.pointerMove(d.x, d.y);
  const extended = await h.snapshot();
  assertDeepEqual(
    extended.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 3, row: 0 },
    ],
    "the trace extends from the resumed far end",
  );
  await h.debug.pointerUp();
});
