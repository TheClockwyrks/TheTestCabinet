// Refract — tracing/resume-from-end: a press on a beam's end resumes it.
//
// specs/controls.md "Beginning a trace", the second grab row: a press on
// either end of a channel's beam resumes that beam from that end. The live
// end is the beam's last cell, so pressing it reorients nothing; the beam
// stays exactly as drawn and an extension to an adjacent node succeeds
// (specs/controls.md "Extending").
//
// The beam is the lens diagonal of GEO_7X6 — T(0,0), t(1,1), t(2,2) — whose
// segments each sit in their own 2x2 block, so the extension to t(3,3) is
// refused by nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
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

it("a press on a released beam's live end resumes the trace there, and an extension succeeds", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_7X6);

  // Draw A -> B -> C and release: `traceCells` runs press, move per cell,
  // release.
  traceCells(h, [A, B, C]);
  assertNull(h.snapshot().tracing, "the drawing trace ended with its release");

  // A press on the beam's live end resumes it from there.
  pressCell(h, C);
  const resumed = h.snapshot();
  assertEqual(
    resumed.tracing?.channel,
    "triangle",
    "the resumed trace carries the beam's channel",
  );
  assertDeepEqual(
    resumed.tracing?.live,
    C,
    "the trace resumes from the pressed end",
  );
  assertDeepEqual(
    resumed.beams.triangle?.cells,
    [A, B, C],
    "resuming leaves the beam as drawn",
  );

  // An extension to an adjacent node succeeds.
  moveToCell(h, D);
  const extended = h.snapshot();
  assertDeepEqual(
    extended.beams.triangle?.cells,
    [A, B, C, D],
    "the extension from the resumed end adds its segment",
  );
  assertDeepEqual(
    extended.tracing?.live,
    D,
    "the extension moves the live end",
  );

  h.debug.pointerUp();

  // Evidence: the beam resumed and extended.
  await h.advance(1);
  captureStill(h, "resumed");
});
