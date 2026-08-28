// Refract — tracing/trace-empty-release: a trace that added nothing leaves the
// beam empty.
//
// `specs/controls.md` "Releasing": a trace that added no segment leaves its
// channel's beam carrying none, so a later press on EITHER of that channel's
// emitters starts the beam afresh. The press-and-release here begins a trace
// at one emitter and extends nowhere; the beam must come out carrying no
// cells — which is exactly what re-arms the first grab row ("an emitter of a
// channel whose beam carries no segments") at BOTH emitters. The later press
// lands on the OTHER emitter, the stronger half of the claim, and the beam
// starts afresh there.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import { R3_REDRAW } from "../fixtures";
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

it("leaves the beam carrying no cells, restartable from either emitter", async () => {
  const board = await loadBoard(h, R3_REDRAW);

  // Press the left emitter and release without extending.
  const left = center(board, { col: 0, row: 0 });
  await h.debug.pointerDown(left.x, left.y);
  const held = await h.snapshot();
  assertDeepEqual(
    held.tracing,
    { channel: "triangle", live: { col: 0, row: 0 } },
    "the press began a trace at the emitter",
  );
  await h.debug.pointerUp();

  const released = await h.snapshot();
  assertNull(released.tracing, "the release ended the trace");
  assertDeepEqual(
    released.beams.triangle?.cells,
    [],
    "a trace that added no segment leaves the beam carrying no cells",
  );

  // A later press on the channel's OTHER emitter starts the beam afresh.
  const right = center(board, { col: 2, row: 0 });
  await h.debug.pointerDown(right.x, right.y);
  await h.advance(1);
  await captureStill(h, "restarted");
  const restarted = await h.snapshot();
  assertDeepEqual(
    restarted.tracing,
    { channel: "triangle", live: { col: 2, row: 0 } },
    "the press on the other emitter begins the channel's trace",
  );
  assertDeepEqual(
    restarted.beams.triangle?.cells,
    [{ col: 2, row: 0 }],
    "the beam starts afresh at that emitter",
  );
  await h.debug.pointerUp();
});
