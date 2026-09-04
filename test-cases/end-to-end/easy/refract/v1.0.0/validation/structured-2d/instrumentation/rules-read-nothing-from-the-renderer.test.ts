// Refract — instrumentation/rules-read-nothing-from-the-renderer: whether a
// segment may be added is decided from the board and the beams alone.
//
// specs/instrumentation.md "A deterministic core": whether a segment may be
// added is decided from the board and the beams alone, never from anything the
// renderer holds. So the same rules decision — a refused move (R2's foreign
// lens) and an accepted one — is taken twice, and the contrast is whether the
// board has been RENDERED at all: once on a board posed and never drawn, once
// on the same board after five frames have drawn it.
//
// ZERO frames are advanced between the pointer calls in either run: no render,
// no update, nothing but the call itself. specs/state.md refreshes `pointer`
// from the runtime layer in every update, so a frame mid-gesture would grade
// the pointer mirror rather than the renderer.
//
// The board is posed through the surface's own `loadBoard` rather than through
// the harness helper, because the helper runs the frame that draws the pose and
// the unrendered leg is the leg that must have no frame in it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureStill,
  createHarness,
  moveToCell,
  notationRows,
  pressCell,
  resetTo,
  type Harness,
} from "../harness";
import type { RefractSnapshot } from "../surface";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
});

afterEach(() => {
  h?.dispose();
});

/**
 * The rules decision, taken with zero frames advanced between the calls:
 * press the triangle emitter, attempt the move onto the square lens (which
 * R2 refuses), then take the move onto the triangle lens (which every limit
 * permits), and release. Returns the snapshot after the release.
 */
function decideOnBoardAndBeamsAlone(
  h: Harness,
  label: string,
): RefractSnapshot {
  pressCell(h, { col: 0, row: 0 });
  assertNotNull(
    h.snapshot().tracing,
    `the press begins a trace at the call (${label})`,
  );

  // The refused segment: s(1,1) is the other channel's lens (R2). Nothing
  // advances; the refusal must resolve in the call, from board + beams alone.
  moveToCell(h, { col: 1, row: 1 });
  const refused = h.snapshot();
  assertLessThanOrEqual(
    refused.beams.triangle?.cells.length ?? 0,
    1,
    `the refused move adds no segment (${label})`,
  );
  assertDeepEqual(
    refused.tracing?.live,
    { col: 0, row: 0 },
    `the refused move leaves the trace live where it was (${label})`,
  );

  // The accepted segment: t(1,0) is the channel's own lens, adjacent, fresh.
  moveToCell(h, { col: 1, row: 0 });
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    `the accepted move adds the segment at the call (${label})`,
  );

  h.debug.pointerUp();
  return h.snapshot();
}

it("a refused and an accepted segment resolve identically with zero frames between the calls", async () => {
  // On a board that has never been rendered: the rules had nothing but the
  // board and the beams to read. The surface's own loadBoard poses it without
  // the frame the harness helper would run.
  h.debug.loadBoard(notationRows(R2_FOREIGN));
  const unrendered = decideOnBoardAndBeamsAlone(
    h,
    "a board that has never been rendered",
  );

  // The same calls on the same board after five frames have drawn it.
  h.debug.loadBoard(notationRows(R2_FOREIGN));
  await h.advance(5);
  const rendered = decideOnBoardAndBeamsAlone(
    h,
    "a board five frames have drawn",
  );

  assertDeepEqual(
    rendered.beams,
    unrendered.beams,
    "the two moves resolve to the same beams on a board that has been " +
      "rendered and on one that never has",
  );
  assertDeepEqual(
    rendered.tracing,
    unrendered.tracing,
    "the release ends the trace the same way on a board that has been " +
      "rendered and on one that never has",
  );

  // Evidence: the board the rules decision was read from, with the accepted
  // segment drawn.
  await h.advance(1);
  captureStill(h, "drive");
});
