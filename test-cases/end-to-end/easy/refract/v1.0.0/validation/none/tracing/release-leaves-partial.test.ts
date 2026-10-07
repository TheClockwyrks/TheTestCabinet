// Refract — tracing/release-leaves-partial: releasing leaves the beam as
// drawn.
//
// `specs/controls.md` "Releasing": the release edge ends the trace and leaves
// the beam exactly as drawn, complete or not — a partial beam persists on the
// board, and a later press on either of its ends resumes it. The beam here is
// [A, B, C] on the 5x1 line, nowhere near complete. After the release the
// snapshot must still carry all three cells with no trace live, and each end
// in turn — the live end C, then the far end A — must take a resuming press.
// (What the far-end press does to the drawn ORDER is `resume-reverses`' point;
// here each press need only resume the beam, live at the pressed end, with
// all three cells still held.)

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNull } from "../assert";
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

it("keeps the partial beam, and either end takes a resuming press", async () => {
  const board = await loadBoard(h, LINE_5);
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 2, row: 0 },
  ]);
  await h.advance(1);
  await captureStill(h, "partial");

  const released = await h.snapshot();
  assertNull(released.tracing, "the release ends the trace");
  assertDeepEqual(
    released.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ],
    "the partial beam persists in the snapshot exactly as drawn",
  );

  // A later press on the live end resumes the beam there.
  const c = center(board, { col: 2, row: 0 });
  await h.debug.pointerDown(c.x, c.y);
  const atC = await h.snapshot();
  assertDeepEqual(
    atC.tracing,
    { channel: "triangle", live: { col: 2, row: 0 } },
    "a press on one end resumes the beam",
  );
  assertLength(
    atC.beams.triangle?.cells ?? [],
    3,
    "resuming drops none of the beam",
  );
  await h.debug.pointerUp();

  // And a press on the other end resumes it too.
  const a = center(board, { col: 0, row: 0 });
  await h.debug.pointerDown(a.x, a.y);
  const atA = await h.snapshot();
  assertDeepEqual(
    atA.tracing,
    { channel: "triangle", live: { col: 0, row: 0 } },
    "a press on the other end resumes the beam as well",
  );
  assertLength(
    atA.beams.triangle?.cells ?? [],
    3,
    "the beam still holds its three cells",
  );
  await h.debug.pointerUp();
});
