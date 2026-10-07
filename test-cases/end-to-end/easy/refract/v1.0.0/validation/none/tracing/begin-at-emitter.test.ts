// Refract — tracing/begin-at-emitter: a press on an emitter starts that
// channel's beam.
//
// The first row of the grab table in `specs/controls.md`: a press that targets
// "an emitter of a channel whose beam carries no segments" starts that
// channel's beam at that emitter, the trace carries the channel of the beam it
// began, and the node it began at is the live end. The board carries TWO
// channels so "that channel" is a real claim: the press lands on a SQUARE
// emitter, and it is the square beam that must start — with the triangle beam
// left exactly as empty as `loadBoard` posed it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts the pressed emitter's channel at that one cell", async () => {
  // Triangle across the top, square across the bottom: both beams empty on
  // arrival (specs/instrumentation.md — loadBoard poses every beam empty).
  const board = await loadBoard(h, R2_FOREIGN);
  const before = await h.snapshot();
  assertDeepEqual(
    before.beams.square?.cells,
    [],
    "the square beam carries no segments before the press",
  );

  // A press on the square emitter at (0, 2).
  const emitter = center(board, { col: 0, row: 2 });
  await h.debug.pointerDown(emitter.x, emitter.y);
  await h.advance(1);
  await captureStill(h, "begun");

  const after = await h.snapshot();
  assertDeepEqual(
    after.tracing,
    { channel: "square", live: { col: 0, row: 2 } },
    "the trace carries the pressed emitter's channel, live at that emitter",
  );
  assertDeepEqual(
    after.beams.square?.cells,
    [{ col: 0, row: 2 }],
    "the square beam holds that one cell",
  );
  assertDeepEqual(
    after.beams.triangle?.cells,
    [],
    "the other channel's beam is untouched",
  );
  await h.debug.pointerUp();
});
