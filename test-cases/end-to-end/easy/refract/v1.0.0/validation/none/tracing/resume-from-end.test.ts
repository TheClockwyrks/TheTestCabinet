// Refract — tracing/resume-from-end: a press on a beam's end resumes it.
//
// The second row of the grab table in `specs/controls.md`: a press on either
// end of a channel's beam resumes that beam from that end, and `specs/
// controls.md` "Releasing" says a partial beam persists for exactly this. The
// end pressed here is the LIVE end — the beam's last cell, the one the drawn
// order already extends from — so no reorientation is involved (that is
// `resume-reverses`' point): the pressed node is simply live again, and one
// move to the adjacent lens adds the segment the limits permit.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
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

it("resumes a released beam from its live end and extends it", async () => {
  // Draw [A, B, C] along the 5x1 line and release: a partial beam, nowhere
  // near complete, persisting on the board.
  const board = await loadBoard(h, LINE_5);
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 2, row: 0 },
  ]);
  const released = await h.snapshot();
  assertNull(released.tracing, "the release ended the trace");
  assertDeepEqual(
    released.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ],
    "the partial beam persists after release",
  );

  // A press on its live end, the last cell (2, 0), resumes the trace there.
  const end = center(board, { col: 2, row: 0 });
  await h.debug.pointerDown(end.x, end.y);
  const resumed = await h.snapshot();
  assertDeepEqual(
    resumed.tracing,
    { channel: "triangle", live: { col: 2, row: 0 } },
    "the press on the beam's live end resumes the trace from there",
  );

  // One move to the adjacent lens at (3, 0) succeeds: the segment is added
  // and that node becomes the live end.
  const next = center(board, { col: 3, row: 0 });
  await h.debug.pointerMove(next.x, next.y);
  await h.advance(1);
  await captureStill(h, "resumed");
  const extended = await h.snapshot();
  assertDeepEqual(
    extended.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 3, row: 0 },
    ],
    "the extension from the resumed end succeeds",
  );
  assertDeepEqual(extended.tracing, {
    channel: "triangle",
    live: { col: 3, row: 0 },
  });
  await h.debug.pointerUp();
});
