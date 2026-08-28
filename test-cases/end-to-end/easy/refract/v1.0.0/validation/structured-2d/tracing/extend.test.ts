// Refract — tracing/extend: dragging to an adjacent node adds a segment.
//
// specs/controls.md "Extending": while the trace is held, the pointer moving
// within NODE_HIT_R (44) of a node adjacent to the live end adds the segment
// joining them, when the rules in specs/beams.md permit it, and that node
// becomes the new live end. The move lands 30 logical units from the lens's
// center — inside NODE_HIT_R but away from the center — so what is exercised
// is the radius, not a lucky exact hit.
//
// The declared output is a REPLAY: the frames the build drew around the move,
// showing the segment appearing on the held trace.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureReplay,
  centerOf,
  createHarness,
  loadBoard,
  pressCell,
  resetTo,
  type Harness,
} from "../harness";

const EMITTER = { col: 0, row: 0 };
const LENS = { col: 1, row: 1 };

/** Inside NODE_HIT_R (44) of the lens's center, but well off the center. */
const OFFSET = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("while the trace is held, a move within NODE_HIT_R of an adjacent node adds the segment and moves the live end", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);

  pressCell(h, EMITTER);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [EMITTER],
    "the held trace starts at the emitter alone",
  );

  const lens = centerOf(h, LENS);
  await captureReplay(h, "extend", async () => {
    await h.advance(6);
    h.debug.pointerMove(lens.x + OFFSET, lens.y);
    await h.advance(12);
  });

  const snap = h.snapshot();
  assertDeepEqual(
    snap.beams.triangle?.cells,
    [EMITTER, LENS],
    "the segment joining the live end and the targeted node is added",
  );
  assertDeepEqual(
    snap.tracing?.live,
    LENS,
    "the targeted node becomes the new live end",
  );

  h.debug.pointerUp();
});
