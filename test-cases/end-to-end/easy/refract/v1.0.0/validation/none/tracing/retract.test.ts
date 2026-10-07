// Refract — tracing/retract: backing up removes the last segment.
//
// `specs/controls.md` "Retracting": the pointer moving within NODE_HIT_R of
// the node immediately behind the live end removes the last segment, and that
// node becomes the live end; a beam is unwound one segment at a time by
// backing the pointer along it WITHOUT RELEASING. The beam [A, B, C, D] is
// drawn and then backed out node by node — [A, B, C], [A, B], then the one
// begun cell [A] — with the trace live at every step, all in one held drag.
// The first backward move lands 40 out from C's center, so the radius figure
// is the one asserted; the rest land on centers, comfortably inside it.
//
// The declared output is a REPLAY, so the whole drag is a real mouse drag —
// one driven frame per sample — and the capture wraps exactly the unwinding.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { NODE_HIT_R } from "../notation";
import {
  captureReplay,
  center,
  createHarness,
  loadBoard,
  mouseGlide,
  mousePress,
  mouseRelease,
  type Harness,
  type RefractSnapshot,
} from "../harness";
import { LINE_5 } from "./helpers";

/** The four cells drawn, A through D, left to right along the line. */
const ROUTE = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
  { col: 2, row: 0 },
  { col: 3, row: 0 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("unwinds the beam one segment at a time without releasing", async () => {
  const board = await loadBoard(h, LINE_5);
  const at = ROUTE.map((cell) => center(board, cell));

  const swept = await captureReplay(h, "retract", async () => {
    await mousePress(h, at[0].x, at[0].y);
    for (const point of at.slice(1)) await mouseGlide(h, point.x, point.y);
    const drawn: RefractSnapshot = await h.snapshot();
    await h.advance(6);

    // Back toward C, stopping NODE_HIT_R - 4 short of its center: within the
    // radius of the node immediately behind the live end.
    await mouseGlide(h, at[2].x + (NODE_HIT_R - 4), at[2].y);
    const toC: RefractSnapshot = await h.snapshot();
    await h.advance(6);

    await mouseGlide(h, at[1].x, at[1].y);
    const toB: RefractSnapshot = await h.snapshot();
    await h.advance(6);

    await mouseGlide(h, at[0].x, at[0].y);
    const toA: RefractSnapshot = await h.snapshot();
    await h.advance(6);

    await mouseRelease(h);
    return { drawn, toC, toB, toA };
  });

  assertDeepEqual(swept.drawn.beams.triangle?.cells, [...ROUTE]);
  assertDeepEqual(
    swept.toC.beams.triangle?.cells,
    ROUTE.slice(0, 3),
    "backing within NODE_HIT_R of the node behind the live end removes the last segment",
  );
  assertDeepEqual(
    swept.toC.tracing,
    { channel: "triangle", live: { col: 2, row: 0 } },
    "that node becomes the live end",
  );
  assertDeepEqual(
    swept.toB.beams.triangle?.cells,
    ROUTE.slice(0, 2),
    "backing again removes the next segment",
  );
  assertDeepEqual(
    swept.toA.beams.triangle?.cells,
    ROUTE.slice(0, 1),
    "the beam is unwound to its begun cell, all without releasing",
  );
  assertDeepEqual(
    swept.toA.tracing,
    { channel: "triangle", live: { col: 0, row: 0 } },
    "the trace is still live at the start of the unwound beam",
  );
});
