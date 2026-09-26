// Refract — tracing/trace-empty-release: a trace that added nothing leaves
// the beam empty.
//
// specs/controls.md "Releasing": a trace that added no segment leaves its
// channel's beam carrying none, so a later press on either of that channel's
// emitters starts the beam afresh. GEO_3X3's triangle emitters are (0, 0) and
// (2, 2); the empty release is exercised at the first, and the fresh starts
// at both — the second being the "EITHER emitter" the item names.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressCell,
  resetTo,
  type Harness,
} from "../harness";

const FIRST = { col: 0, row: 0 };
const OTHER = { col: 2, row: 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a press released without extending leaves the beam carrying no cells, and either emitter then starts it afresh", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);

  // Press an emitter and release without extending.
  pressCell(h, FIRST);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [FIRST],
    "the press began the beam at the emitter",
  );
  h.debug.pointerUp();

  const emptied = h.snapshot();
  assertNull(emptied.tracing, "the release ended the trace");
  assertDeepEqual(
    emptied.beams.triangle?.cells,
    [],
    "a trace that added no segment leaves the beam carrying no cells",
  );

  // The same emitter starts the beam afresh...
  pressCell(h, FIRST);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [FIRST],
    "the same emitter starts the beam afresh",
  );
  h.debug.pointerUp();

  // ...and so does the channel's OTHER emitter.
  pressCell(h, OTHER);
  const restarted = h.snapshot();
  assertEqual(
    restarted.tracing?.channel,
    "triangle",
    "the other emitter begins the channel's trace",
  );
  assertDeepEqual(
    restarted.beams.triangle?.cells,
    [OTHER],
    "the beam starts afresh from the other emitter",
  );

  // Evidence: the beam started afresh from the other emitter.
  await h.advance(1);
  captureStill(h, "restarted");
  h.debug.pointerUp();
});
