// Refract — instrumentation/trace-prefix: a refused trace keeps its
// permitted prefix.
//
// specs/instrumentation.md, on `trace`: running entirely through the pointer
// path, a trace is subject to every limit a hand-drawn trace is, and "a list
// the limits refuse part way through leaves the beam ending at the last
// segment they permitted". The list here is three cells on R2_FOREIGN whose
// third hop lands on the OTHER channel's lens — refused by R2
// (specs/beams.md: a beam never meets an emitter or a lens of another
// channel) — so the beam must hold exactly the first two cells, and the call
// must return rather than throw.

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
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a list refused part way through keeps the permitted prefix, without throwing", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R2_FOREIGN);

  // T(0,0) -> t(1,0) is legal; the third hop, onto the square lens s(1,1),
  // is a move R2 refuses. The game does not throw over it.
  assertDoesNotThrow(
    () =>
      h.debug.trace([
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 1, row: 1 },
      ]),
    "a trace whose hop the limits refuse returns normally",
  );

  const snap = h.snapshot();

  // The beam ends at the last segment the limits permitted: exactly the
  // first two cells.
  assertDeepEqual(
    snap.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the beam holds exactly the permitted prefix",
  );
  assertEqual(
    snap.beams.triangle?.complete,
    false,
    "a prefix ending on a lens is not complete",
  );

  // The trace ran to its release: nothing was left live, and the game reads
  // back normally.
  assertNull(snap.tracing, "the trace ended with its release");
  assertEqual(snap.screen, "playing", "the game plays on");

  // Evidence: the frame showing the beam holding the permitted prefix.
  await h.advance(1);
  captureStill(h, "prefix");
});
