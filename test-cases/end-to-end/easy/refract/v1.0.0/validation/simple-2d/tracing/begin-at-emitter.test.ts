// Refract — tracing/begin-at-emitter: a press on an emitter starts that
// channel's beam.
//
// specs/controls.md "Beginning a trace", first grab row: a press targeting an
// emitter of a channel whose beam carries no segments starts that channel's
// beam at that emitter. The trace carries the channel of the beam it began,
// and the node it began at is the live end.
//
// The board is R9_UNIQUE (fixtures.ts), one triangle channel; the precondition
// — the beam carrying no segments — is read back before the press, so the row
// exercised is unambiguously the first one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { R9_UNIQUE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
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

it("starts the channel's beam at the pressed emitter, holding that one cell", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R9_UNIQUE);

  // The precondition of the first grab row: the beam carries no segments.
  assertEqual(
    h.snapshot().beams.triangle?.cells.length,
    0,
    "before the press, the triangle beam carries no cells",
  );

  const emitter = nodeCenter(0, 0, 4, 3);
  h.debug.pointerDown(emitter.x, emitter.y);
  await h.advance(1);
  captureStill(h, "begun");

  const snapshot = h.snapshot();
  assertNotNull(
    snapshot.tracing,
    "a press on an emitter of a channel whose beam carries no segments " +
      "begins a trace (specs/controls.md, first grab row)",
  );
  assertEqual(
    snapshot.tracing?.channel,
    "triangle",
    "the trace carries the channel of the beam it began",
  );
  assertDeepEqual(
    snapshot.tracing?.live,
    { col: 0, row: 0 },
    "the node the trace began at is the live end",
  );
  assertDeepEqual(
    snapshot.beams.triangle?.cells,
    [{ col: 0, row: 0 }],
    "the beam starts at that emitter, holding that one cell",
  );

  h.debug.pointerUp();
});
