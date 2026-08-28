// ruleset/r2-exclusion — R2: a beam never meets an emitter or a lens of
// another channel.
//
// The board is the R2_FOREIGN fixture — triangle across the top, square across
// the bottom, a square lens in the middle — and the two probes are the two the
// manifest item names:
//
//   1. the triangle beam moving onto the square's lens s(1,1), and
//   2. the square beam moving onto the triangle's emitter T(2,0).
//
// Each refused target is 8-adjacent to its live end, the segment is fresh, no
// drawn diagonal crosses it, and every capacity is clear — so R2 is the only
// rule the move breaks, and a build that refuses it for R2 is the build the
// spec describes. Refusal is read as specs/beams.md Enforcement states it: the
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
  await resetTo(h, 1);
  await loadBoard(h, R2_FOREIGN);
});

afterEach(() => {
  h?.dispose();
});

it("refuses a move onto another channel's lens and onto its emitter", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  // Probe 1 — another channel's LENS. The triangle trace begins at T(0,0);
  // the diagonal to s(1,1) is adjacent and otherwise clean, but the lens
  // belongs to the square channel.
  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  const beforeLens = h.snapshot();
  assertLiveTrace(
    beforeLens,
    "triangle",
    { col: 0, row: 0 },
    "the press on the triangle emitter begins the trace",
  );

  h.debug.pointerMove(at(1, 1).x, at(1, 1).y);
  const atLens = h.snapshot();
  assertDeepEqual(
    atLens.beams,
    beforeLens.beams,
    "R2: a move onto another channel's lens is refused — the beam is " +
      "unchanged (specs/beams.md)",
  );
  assertLiveTrace(
    atLens,
    "triangle",
    { col: 0, row: 0 },
    "the refused move onto the foreign lens leaves the trace live",
  );
  h.debug.pointerUp();

  // Probe 2 — another channel's EMITTER. The square beam runs S(0,2) to its
  // own lens s(1,1) (a permitted diagonal), and from there the diagonal to
  // T(2,0) is adjacent and otherwise clean, but the emitter is the triangle's.
  h.debug.pointerDown(at(0, 2).x, at(0, 2).y);
  h.debug.pointerMove(at(1, 1).x, at(1, 1).y);
  const beforeEmitter = h.snapshot();
  assertDeepEqual(
    beforeEmitter.beams.square?.cells,
    [
      { col: 0, row: 2 },
      { col: 1, row: 1 },
    ],
    "the square beam reaches its own lens before the probe (specs/beams.md " +
      "permits the segment)",
  );

  h.debug.pointerMove(at(2, 0).x, at(2, 0).y);
  const atEmitter = h.snapshot();
  assertDeepEqual(
    atEmitter.beams,
    beforeEmitter.beams,
    "R2: a move onto another channel's emitter is refused — the beam is " +
      "unchanged (specs/beams.md)",
  );
  assertLiveTrace(
    atEmitter,
    "square",
    { col: 1, row: 1 },
    "the refused move onto the foreign emitter leaves the trace live",
  );

  // Evidence: the beam unchanged at the other channel's nodes, mid-trace.
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.pointerUp();
});
