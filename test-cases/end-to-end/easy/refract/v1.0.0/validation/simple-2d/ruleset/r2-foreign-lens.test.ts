// ruleset/r2-foreign-lens — R2: a beam never meets a lens of another channel.
//
// The board is the R2_FOREIGN fixture — triangle across the top, square across
// the bottom, a square lens in the middle. The triangle trace begins at T(0,0)
// and moves onto the square's lens s(1,1): the target is 8-adjacent to the live
// end, the segment is fresh, no drawn diagonal crosses it, and every capacity
// is clear — so R2 is the only rule the move breaks, and a build that refuses
// it for R2 is the build the spec describes. Refusal is read as specs/beams.md
// Enforcement states it: the beam unchanged, the trace still live.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";
import { assertLiveTrace } from "./support";

/** R2_FOREIGN is `TtT / .s. / S.S`: 3 columns, 3 rows. */
const COLS = 3;
const ROWS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h);
  await loadBoard(h, R2_FOREIGN);
});

afterEach(() => {
  h?.dispose();
});

it("refuses a move onto another channel's lens", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  // The triangle trace begins at T(0,0); the diagonal to s(1,1) is adjacent
  // and otherwise clean, but the lens belongs to the square channel.
  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  const before = h.snapshot();
  assertLiveTrace(
    before,
    "triangle",
    { col: 0, row: 0 },
    "the press on the triangle emitter begins the trace",
  );

  h.debug.pointerMove(at(1, 1).x, at(1, 1).y);
  const after = h.snapshot();
  assertDeepEqual(
    after.beams,
    before.beams,
    "R2: a move onto another channel's lens is refused — the beam is " +
      "unchanged (specs/beams.md)",
  );
  assertLiveTrace(
    after,
    "triangle",
    { col: 0, row: 0 },
    "the refused move onto the foreign lens leaves the trace live",
  );

  // Evidence: the beam unchanged at the other channel's lens, mid-trace.
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.pointerUp();
});
