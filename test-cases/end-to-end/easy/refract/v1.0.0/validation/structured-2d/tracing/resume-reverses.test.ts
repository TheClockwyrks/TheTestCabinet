// Refract — tracing/resume-reverses: resuming from the other end reverses the
// drawn order.
//
// specs/controls.md "The drawn order and shortening": whenever a trace begins
// on a beam, the beam is first oriented so the node the trace extends from is
// its LAST cell, reversing the held order when the trace begins from the
// other end.
//
// The reversal is exercised from both far ends. The first press lands on the
// emitter A the beam was drawn from — the cells must read C, B, A — and no
// extension is demonstrated there, because A already carries its one segment
// and R5 (specs/beams.md) caps an emitter at one, so every move from it is
// refused. The second press lands on the far end that reversal created, the
// lens C — the cells must read A, B, C again — and from that end the
// extension to the adjacent lens D succeeds, which is the "trace extends from
// that end" half of the rule.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { GEO_7X6 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  moveToCell,
  pressCell,
  resetTo,
  traceCells,
  type Harness,
} from "../harness";

const A = { col: 0, row: 0 };
const B = { col: 1, row: 1 };
const C = { col: 2, row: 2 };
const D = { col: 3, row: 3 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a press on the far end reorients the beam so the pressed node is its last cell, and the trace extends from there", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_7X6);

  // Draw A -> B -> C and release.
  traceCells(h, [A, B, C]);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [A, B, C],
    "the beam is drawn A, B, C before any resume",
  );

  // Press the far end A: the held order reverses so A is the last cell.
  pressCell(h, A);
  const reversed = h.snapshot();
  assertDeepEqual(
    reversed.beams.triangle?.cells,
    [C, B, A],
    "the snapshot's cells read in reversed order",
  );
  assertDeepEqual(
    reversed.tracing?.live,
    A,
    "the pressed far end is the live end",
  );
  h.debug.pointerUp();

  // Press the beam's far end again — now the lens C — and the order reverses
  // back; from this end the extension succeeds.
  pressCell(h, C);
  const restored = h.snapshot();
  assertDeepEqual(
    restored.beams.triangle?.cells,
    [A, B, C],
    "pressing the other far end reverses the order again",
  );
  assertDeepEqual(restored.tracing?.live, C, "the trace works from that end");

  moveToCell(h, D);
  const extended = h.snapshot();
  assertDeepEqual(
    extended.beams.triangle?.cells,
    [A, B, C, D],
    "the trace extends from the reoriented end",
  );
  assertEqual(
    extended.tracing?.channel,
    "triangle",
    "the resumed trace carries the beam's channel throughout",
  );
  h.debug.pointerUp();

  // Evidence: the beam resumed from its far end.
  await h.advance(1);
  captureStill(h, "reversed");
});
