// Refract — tracing/begin-at-emitter: a press on an emitter starts that
// channel's beam.
//
// specs/controls.md "Beginning a trace", the first grab row: a press on an
// emitter of a channel whose beam carries no segments starts that channel's
// beam at that emitter. The trace carries the channel of the beam it began,
// and the node it began at is the live end — so the beam holds that one cell.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressCell,
  resetTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a press on an emitter of a channel whose beam carries no segments starts that beam at that emitter", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);

  // The precondition of the grab row: the channel's beam carries no segments.
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [],
    "the channel's beam carries no segments before the press",
  );

  pressCell(h, { col: 0, row: 0 });

  const snap = h.snapshot();
  assertEqual(
    snap.tracing?.channel,
    "triangle",
    "the trace carries the pressed emitter's channel",
  );
  assertDeepEqual(
    snap.tracing?.live,
    { col: 0, row: 0 },
    "the node the trace began at is the live end",
  );
  assertDeepEqual(
    snap.beams.triangle?.cells,
    [{ col: 0, row: 0 }],
    "the beam holds that one cell",
  );

  // Evidence: the trace begun at the emitter.
  await h.advance(1);
  captureStill(h, "begun");
  h.debug.pointerUp();
});
