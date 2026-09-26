// ruleset/r2-foreign-emitter — R2: a beam never meets an emitter of another
// channel.
//
// The board is the R2_FOREIGN fixture — triangle across the top, square across
// the bottom, a square lens in the middle. The square beam runs S(0,2) to its
// own lens s(1,1) (a permitted diagonal), and from there the diagonal to T(2,0)
// is adjacent, its segment fresh, no drawn diagonal crossing it and every
// capacity clear — but the emitter is the triangle's, so R2 is the only rule
// the move breaks. Refusal is read as specs/beams.md Enforcement states it: the
// beam unchanged, the trace still live.

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

it("refuses a move onto another channel's emitter", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  h.debug.pointerDown(at(0, 2).x, at(0, 2).y);
  h.debug.pointerMove(at(1, 1).x, at(1, 1).y);
  const before = h.snapshot();
  assertDeepEqual(
    before.beams.square?.cells,
    [
      { col: 0, row: 2 },
      { col: 1, row: 1 },
    ],
    "the square beam reaches its own lens before the probe (specs/beams.md " +
      "permits the segment)",
  );

  h.debug.pointerMove(at(2, 0).x, at(2, 0).y);
  const after = h.snapshot();
  assertDeepEqual(
    after.beams,
    before.beams,
    "R2: a move onto another channel's emitter is refused — the beam is " +
      "unchanged (specs/beams.md)",
  );
  assertLiveTrace(
    after,
    "square",
    { col: 1, row: 1 },
    "the refused move onto the foreign emitter leaves the trace live",
  );

  // Evidence: the beam unchanged at the other channel's emitter, mid-trace.
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.pointerUp();
});
