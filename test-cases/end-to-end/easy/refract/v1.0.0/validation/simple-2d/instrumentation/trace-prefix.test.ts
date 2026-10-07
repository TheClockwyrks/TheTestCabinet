// Refract — instrumentation/trace-prefix: a refused hop keeps the route's
// permitted prefix.
//
// specs/instrumentation.md, of the three pointer operations: they drive the
// same path a player's pointer drives, "a move the limits refuse changes
// nothing and leaves the trace live", and "the release ends the trace and
// leaves the beam as drawn". A move the rules refuse changes nothing and the
// trace stays live (specs/beams.md "Enforcement"), so the refused hop is
// simply not drawn — and nothing throws.
//
// The scenario is R2_FOREIGN (spec-derived, fixtures.ts): the traced route is
// [T(0,0), t(1,0), s(1,1)] — the first hop is a legal own-channel segment,
// and the hop to the third cell lands on the square channel's lens, which R2
// refuses to the triangle beam. The beam is left holding exactly the first
// two cells.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDoesNotThrow,
  assertEqual,
  assertNull,
} from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  traceRoute,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the beam ending at the last segment the limits permitted", async () => {
  await resetTo(h);
  await loadBoard(h, R2_FOREIGN);

  // The third cell is another channel's lens: R2 refuses that hop, and the
  // game does not throw over a refused list.
  assertDoesNotThrow(
    () =>
      traceRoute(h, [
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    "a trace the limits refuse part way through must not throw",
  );

  const s = h.snapshot();
  await h.advance(1);
  captureStill(h, "prefix");

  assertDeepEqual(
    s.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the beam ends at the last segment the limits permitted — exactly the " +
      "first two cells (specs/instrumentation.md)",
  );
  assertNull(s.tracing, "trace's own release ends the trace");
  assertEqual(s.screen, "playing", "the game plays on after the refusal");
});
