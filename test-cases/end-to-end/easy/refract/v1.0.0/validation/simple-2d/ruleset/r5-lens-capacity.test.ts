// ruleset/r5-lens-capacity — R5: a lens carries at most two segments of its
// own channel.
//
// The board is the R5_LENS fixture, `T.. / tt. / .tT`. The triangle beam runs
// T(0,0)-t(1,1)-t(0,1)-t(1,2) in one live trace, at which point the lens
// t(1,1) already carries two segments of its own channel. The probe is the
// vertical from the live end t(1,2) back onto t(1,1): a third segment of that
// channel onto the lens, refused by R5 alone — the lens is the channel's own
// (R2 clear), the segment is fresh (R3 clear) and not a diagonal (R4 clear),
// and the node behind the live end is t(0,1), so this is an extension attempt
// rather than a retract (specs/controls.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R5_LENS } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";
import { assertLiveTrace } from "./support";

/** R5_LENS is `T.. / tt. / .tT`: 3 columns, 3 rows. */
const COLS = 3;
const ROWS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h);
  await loadBoard(h, R5_LENS);
});

afterEach(() => {
  h?.dispose();
});

it("refuses a third segment of the channel onto a lens carrying its two", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  h.debug.pointerMove(at(1, 1).x, at(1, 1).y);
  h.debug.pointerMove(at(0, 1).x, at(0, 1).y);
  h.debug.pointerMove(at(1, 2).x, at(1, 2).y);
  const before = h.snapshot();
  assertDeepEqual(
    before.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 0, row: 1 },
      { col: 1, row: 2 },
    ],
    "the beam threads the lens t(1,1) with its two segments and reaches " +
      "t(1,2) (specs/beams.md permits every segment of it)",
  );

  // The probe: a third segment of the triangle channel onto the full lens.
  h.debug.pointerMove(at(1, 1).x, at(1, 1).y);
  const refused = h.snapshot();
  assertDeepEqual(
    refused.beams,
    before.beams,
    "R5: a third segment of the channel onto a lens already carrying two " +
      "of its own is refused — the beam is unchanged (specs/beams.md)",
  );
  assertLiveTrace(
    refused,
    "triangle",
    { col: 1, row: 2 },
    "the refused third segment leaves the trace live",
  );

  // Evidence: the lens refusing a third segment, mid-trace.
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.pointerUp();
});
